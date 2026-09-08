"""
The core of this service: takes a raw client request, concatenates it with
QuotationPrompt.md as the system prompt, runs it through the chat vLLM
sidecar (services/inference_client.py), and returns the recognized JSON per
quote. Direct Python port of quotation-service's llm-client.ts, minus the
multi-provider dispatch (gemini/ollama/lmstudio) — there is now exactly one
inference path (the OpenAI-compatible vLLM sidecar), so that branching no
longer applies.

Deliberately does NOT catch or fall back on failure — any error (sidecar
unreachable, malformed response, ...) propagates to the caller
(routers/analyze.py), which turns it into a clear `{ success: false, error }`
response. There is no silent degraded mode: an extraction failure must be
visible, not masked behind a best-effort deterministic guess.
"""
import json
import re

from .. import config, db
from . import inference_client

_THINK_TAG_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_BRACE_RE = re.compile(r"\{[\s\S]*\}")
_BRACKET_RE = re.compile(r"\[[\s\S]*\]")


def load_quotation_prompt() -> str:
    return config.QUOTATION_PROMPT_PATH.read_text(encoding="utf-8").strip()


FINANCIAL_PARSER_SYSTEM_PROMPT = load_quotation_prompt()


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


def analyze_query(query: str) -> dict:
    user_prompt = (
        f'Analyse cette demande client de produit(s) structuré(s) et extrais les spécifications au format JSON :\n"{query}"'
        f"\n\nIMPORTANT: Réponds uniquement avec l'objet JSON valide (une clé \"quotes\" contenant un tableau)."
    )
    raw_text = inference_client.chat_completion(FINANCIAL_PARSER_SYSTEM_PROMPT, user_prompt)
    parsed_json = extract_json_from_text(raw_text)

    model_used = db.get_llm_settings()["model"]
    if not parsed_json:
        raise RuntimeError(f'Le modèle ("{model_used}") a répondu sans JSON valide décodable.')

    return {"modelUsed": model_used, "rawQuotes": normalize_to_raw_quotes(parsed_json)}
