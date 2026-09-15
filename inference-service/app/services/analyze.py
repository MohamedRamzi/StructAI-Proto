"""
The core of `/api/analyze`. Two pipelines:

- "routed" (default): step 1 classifies the request (services/routing.py),
  step 2 resolves a domain pre-prompt per (assetClass, family) by a
  deterministic cascade (services/prompt_resolver.py), step 3 runs one
  extraction LLM call per distinct scope group with that pre-prompt +
  `_common` as the system prompt. Output is a RICH schema per product family
  (autocall/v1, rates/v1, ...). Confidence is weighted by how specific the
  matched pre-prompt was.

- "single": one extraction call with the `default` domain prompt + `_common`,
  no routing — reproduces the pre-refacto behaviour (flat `generic/v1`
  schema), kept for rollback / A-B comparison.

Deliberately does NOT catch or fall back on failure — any error (LLM call
fails, malformed response, ...) propagates to routers/analyze.py, which turns
it into a clear `{ success: false, error }`. No silent degraded mode.
"""
import json
import re
import time
from collections import OrderedDict
from typing import Optional

from .. import db
from . import inference_client

_THINK_TAG_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_BRACE_RE = re.compile(r"\{[\s\S]*\}")
_BRACKET_RE = re.compile(r"\[[\s\S]*\]")

# Fallback schemaVersion by prompt key, used only if the model didn't put one
# in its output.
_SCHEMA_BY_PROMPT_KEY = {
    "equity-autocall": "autocall/v1",
    "rates": "rates/v1",
    "fx": "fx/v1",
    "credit": "credit/v1",
}
_SCOPE_CONFIDENCE_FACTOR = {3: 1.0, 2: 0.9, 1: 0.75}


def extract_json_from_text(raw_text):
    """
    Extracts and parses a JSON object/array from a string that may contain
    Markdown formatting, reasoning tags (<think>...</think>), or raw prose
    (Qwen/DeepSeek-style outputs that don't strictly honor JSON mode).
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    cleaned_text = _THINK_TAG_RE.sub("", raw_text).strip()

    try:
        return json.loads(cleaned_text)
    except (ValueError, json.JSONDecodeError):
        pass

    json_block_match = _JSON_BLOCK_RE.search(cleaned_text)
    if json_block_match:
        try:
            return json.loads(json_block_match.group(1).strip())
        except (ValueError, json.JSONDecodeError):
            pass

    brace_match = _BRACE_RE.search(cleaned_text)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except (ValueError, json.JSONDecodeError):
            pass

    bracket_match = _BRACKET_RE.search(cleaned_text)
    if bracket_match:
        try:
            return json.loads(bracket_match.group(0))
        except (ValueError, json.JSONDecodeError):
            pass

    return None


def normalize_to_raw_quotes(parsed_json) -> list[dict]:
    """Normalizes a parsed LLM JSON payload into a list of per-quote raw extractions."""
    if not parsed_json:
        return []
    if isinstance(parsed_json, dict):
        if isinstance(parsed_json.get("quotes"), list):
            return parsed_json["quotes"]
        if isinstance(parsed_json.get("quote"), list):
            return parsed_json["quote"]
        if isinstance(parsed_json.get("quotes"), dict):
            return [parsed_json["quotes"]]
        return [parsed_json]
    if isinstance(parsed_json, list):
        return parsed_json
    return []


def _common_prompt_body() -> str:
    row = db.get_prompt("_common")
    if row is None:
        raise RuntimeError(
            "Aucun pré-prompt '_common' en base — le seed des prompts a échoué. "
            "Vérifiez inference-service/prompts/_common.md."
        )
    return row["body"]


def _system_prompt(domain_body: str) -> str:
    return f"{domain_body}\n\n---\n\n{_common_prompt_body()}"


def _run_extraction(system_prompt: str, user_prompt: str, reasoning_mode: Optional[str] = None) -> list[dict]:
    raw_text = inference_client.chat_completion(system_prompt, user_prompt, reasoning_mode=reasoning_mode)
    parsed = extract_json_from_text(raw_text)
    if not parsed:
        model = db.get_llm_settings()["model"]
        raise RuntimeError(f'Le modèle ("{model}") a répondu sans JSON valide décodable.')
    return normalize_to_raw_quotes(parsed)


def _finalize_quote(raw: dict, index: int, routing: Optional[dict], prompt_key: str) -> dict:
    schema_version = raw.get("schemaVersion") or _SCHEMA_BY_PROMPT_KEY.get(prompt_key, "generic/v1")
    quote_id = raw.get("quoteId", index + 1)
    label = raw.get("label") or raw.get("productTypeName") or raw.get("productName") or f"Cotation {quote_id}"

    confidence = raw.get("confidenceScore")
    scope_precision = routing["scopePrecision"] if routing else 1
    if isinstance(confidence, (int, float)):
        raw["confidenceScore"] = round(float(confidence) * _SCOPE_CONFIDENCE_FACTOR.get(scope_precision, 1.0), 4)

    return {
        "quoteId": quote_id,
        "label": label,
        "schemaVersion": schema_version,
        "routing": routing,
        "extraction": raw,
    }


def _analyze_single(query: str, reasoning_mode: Optional[str] = None, trace: Optional[dict] = None) -> dict:
    default_prompt = db.get_prompt("default")
    if default_prompt is None:
        raise RuntimeError("Aucun pré-prompt 'default' en base — le seed des prompts a échoué.")
    system_prompt = _system_prompt(default_prompt["body"])
    user_prompt = (
        f'Analyse cette demande client de produit(s) structuré(s) et extrais les spécifications au format JSON :\n"{query}"'
        "\n\nIMPORTANT: Réponds uniquement avec l'objet JSON valide (une clé \"quotes\" contenant un tableau)."
    )
    extraction_started = time.monotonic()
    raw_quotes = _run_extraction(system_prompt, user_prompt, reasoning_mode)
    if trace is not None:
        trace["extractionMs"] = round((time.monotonic() - extraction_started) * 1000)
    routing = {"promptKey": "default", "scopePrecision": 1, "assetClass": None, "productFamily": None, "routerConfidence": None}
    quotes = [_finalize_quote(raw, i, routing, "default") for i, raw in enumerate(raw_quotes)]
    return {"modelUsed": db.get_llm_settings()["model"], "pipeline": "single", "quotes": quotes}


def _analyze_routed(query: str, reasoning_mode: Optional[str] = None, trace: Optional[dict] = None) -> dict:
    from . import prompt_resolver, routing as routing_svc

    routing_started = time.monotonic()
    classifications = routing_svc.classify_request(query, reasoning_mode=reasoning_mode)
    if trace is not None:
        trace["routingMs"] = round((time.monotonic() - routing_started) * 1000)
        trace["routing"] = classifications

    # Resolve a domain prompt per classification, then group by resolved promptKey.
    groups: "OrderedDict[str, dict]" = OrderedDict()
    for cls in classifications:
        resolution = prompt_resolver.resolve(cls["assetClass"], cls["productFamily"])
        key = resolution["promptKey"]
        group = groups.setdefault(key, {"resolution": resolution, "classifications": []})
        group["classifications"].append(cls)

    single_group = len(groups) == 1
    merged: dict[object, dict] = {}
    extraction_elapsed_s = 0.0

    for key, group in groups.items():
        resolution = group["resolution"]
        member_ids = [c["quoteId"] for c in group["classifications"]]
        system_prompt = _system_prompt(resolution["promptBody"])

        if single_group:
            user_prompt = (
                f'Analyse cette demande client et extrais les spécifications au format JSON :\n"{query}"'
                "\n\nIMPORTANT: Réponds uniquement avec l'objet JSON valide (une clé \"quotes\" contenant un tableau)."
            )
        else:
            id_list = ", ".join(str(i) for i in member_ids)
            user_prompt = (
                f'Voici une demande client contenant plusieurs cotations :\n"{query}"'
                f"\n\nTu ne dois traiter QUE la ou les cotation(s) portant sur un produit de type "
                f"« {resolution['productFamily'] or 'ce type'} » en classe d'actif « {resolution['assetClass'] or 'cette classe'} » "
                f"— c'est-à-dire les cotations d'identifiant : {id_list}. Ignore les autres."
                "\n\nIMPORTANT: Réponds uniquement avec l'objet JSON valide (une clé \"quotes\" contenant un tableau), "
                "en conservant les quoteId d'origine."
            )

        extraction_started = time.monotonic()
        raw_quotes = _run_extraction(system_prompt, user_prompt, reasoning_mode)
        extraction_elapsed_s += time.monotonic() - extraction_started

        # Attach this group's routing to each quote it produced, matched to a
        # classification by quoteId when possible, else positionally.
        by_id = {c["quoteId"]: c for c in group["classifications"]}
        for i, raw in enumerate(raw_quotes):
            qid = raw.get("quoteId", member_ids[i] if i < len(member_ids) else i + 1)
            cls = by_id.get(qid) or (group["classifications"][i] if i < len(group["classifications"]) else None)
            routing = {
                "assetClass": resolution["assetClass"],
                "productFamily": resolution["productFamily"],
                "promptKey": resolution["promptKey"],
                "scopePrecision": resolution["scopePrecision"],
                "routerConfidence": cls["routerConfidence"] if cls else None,
            }
            merged[qid] = _finalize_quote(raw, i, routing, resolution["promptKey"])

    if trace is not None:
        trace["extractionMs"] = round(extraction_elapsed_s * 1000)

    quotes = [merged[qid] for qid in sorted(merged, key=lambda x: (isinstance(x, str), x))]
    return {"modelUsed": db.get_llm_settings()["model"], "pipeline": "routed", "quotes": quotes}


def _analyze_route_only(query: str, reasoning_mode: Optional[str] = None, trace: Optional[dict] = None) -> dict:
    """Just step 1+2: the router LLM call + the deterministic pre-prompt cascade,
    with NO extraction call. For iterating on the router prompt / asset-class
    selection cheaply. Quotes carry only `routing` — no `extraction`, no schema,
    no pricing."""
    from . import prompt_resolver, routing as routing_svc

    routing_started = time.monotonic()
    classifications = routing_svc.classify_request(query, reasoning_mode=reasoning_mode)
    if trace is not None:
        trace["routingMs"] = round((time.monotonic() - routing_started) * 1000)
        trace["routing"] = classifications
    quotes = []
    for cls in classifications:
        resolution = prompt_resolver.resolve(cls["assetClass"], cls["productFamily"])
        quotes.append({
            "quoteId": cls["quoteId"],
            "label": cls.get("label") or f"Cotation {cls['quoteId']}",
            "routing": {
                "assetClass": resolution["assetClass"],
                "productFamily": resolution["productFamily"],           # canonical
                "productFamilyRaw": cls.get("productFamily"),           # what the model said
                "underlying": cls.get("underlying"),
                "routerConfidence": cls.get("routerConfidence"),
                "promptKey": resolution["promptKey"],
                "scopePrecision": resolution["scopePrecision"],
            },
        })
    return {"modelUsed": db.get_llm_settings()["model"], "pipeline": "route", "quotes": quotes}


def analyze_query(query: str, pipeline: str = "routed", reasoning_mode: Optional[str] = None, trace: Optional[dict] = None) -> dict:
    """`trace`, when passed, is filled in-place with step timings/intermediate
    results (routingMs, routing, extractionMs) as the pipeline progresses —
    used by routers/analyze.py to write a parsing_logs row, including partial
    data when a later step fails. Not part of the public API response."""
    if pipeline == "route":
        return _analyze_route_only(query, reasoning_mode, trace=trace)
    if pipeline == "single":
        return _analyze_single(query, reasoning_mode, trace=trace)
    return _analyze_routed(query, reasoning_mode, trace=trace)
