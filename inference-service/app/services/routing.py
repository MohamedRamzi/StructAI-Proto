"""
Step 1 of the routed-analyze pipeline: one short LLM call that CLASSIFIES the
client request (per quote) into {assetClass, productFamily, underlying?,
routerConfidence} — it does NOT extract product parameters, that's step 3.

Uses the `router` prompt row as the system prompt. Reuses inference_client and
the same tolerant JSON extraction as the main analyze step. Deliberately does
not catch/fall back on failure — an error propagates (same no-silent-fallback
principle applied everywhere in this service).
"""
from typing import Optional

from .. import db
from . import inference_client
from .analyze import extract_json_from_text, normalize_to_raw_quotes

_VALID_ASSET_CLASSES = {"EQUITY", "RATES", "FX"}


def _router_prompt_body() -> str:
    row = db.get_prompt("router")
    if row is None:
        raise RuntimeError(
            "Aucun pré-prompt 'router' en base — le seed des prompts a échoué. "
            "Vérifiez inference-service/prompts/router.md."
        )
    return row["body"]


def classify_request(query: str, reasoning_mode: Optional[str] = None) -> list[dict]:
    """Returns [{quoteId, assetClass, productFamily, underlying, routerConfidence}, ...]."""
    system_prompt = _router_prompt_body()
    user_prompt = (
        "Classe la demande client suivante. Réponds uniquement avec l'objet JSON "
        f'décrit (une clé "quotes").\n\n"{query}"'
    )
    raw_text = inference_client.chat_completion(system_prompt, user_prompt, reasoning_mode=reasoning_mode)
    parsed = extract_json_from_text(raw_text)
    if not parsed:
        model = db.get_llm_settings()["model"]
        raise RuntimeError(f'Le routage a échoué : le modèle ("{model}") a répondu sans JSON valide décodable.')

    classifications: list[dict] = []
    for index, raw in enumerate(normalize_to_raw_quotes(parsed)):
        asset_class = str(raw.get("assetClass") or raw.get("AssetClass") or "").strip().upper()
        asset_class = asset_class if asset_class in _VALID_ASSET_CLASSES else None
        product_family = raw.get("productFamily") or raw.get("ProductFamily") or None

        classifications.append({
            "quoteId": raw.get("quoteId", index + 1),
            "label": raw.get("label") or raw.get("Label") or None,
            "assetClass": asset_class,
            "productFamily": product_family,
            "underlying": (raw.get("underlying") or raw.get("underlyingQueryOrTicker") or None),
            "routerConfidence": _as_float(raw.get("routerConfidence")),
        })

    if not classifications:
        raise RuntimeError("Le routage n'a retourné aucune cotation classable.")
    return classifications


def _as_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
