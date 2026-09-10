"""
Flags fields the LLM could not extract, so the caller can surface "please
clarify X" instead of silently defaulting. Schema-aware: the required-field
set depends on the schemaVersion the extraction was produced against
(generic/v1 = the old flat schema; autocall/v1, rates/v1, ... = the rich
per-family envelopes).
"""
from typing import Any, Optional

# generic/v1 — product types whose payoff depends on a PDI (protection) barrier.
_BARRIER_DEPENDENT_PRODUCT_IDS = {
    "AUTOCALL_CLASSIC", "PHOENIX_MEMORY", "AUTOCALL_AIRBAG", "ATHENA_AIRBAG", "REVERSE_CONVERTIBLE",
}


def _flag(field: str, label: str, message: str) -> dict:
    return {"field": field, "label": label, "message": message}


def _is_blank(value: Any) -> bool:
    return value is None or value == "" or (isinstance(value, (list, dict)) and len(value) == 0)


def _get(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _detect_generic(extraction: dict) -> list[dict]:
    flags: list[dict] = []

    if _is_blank(extraction.get("maturityMonths")):
        flags.append(_flag("maturityMonths", "Maturité totale (mois)", "Maturité non spécifiée dans la demande client."))

    if _is_blank(extraction.get("underlyingQueryOrTicker")):
        flags.append(_flag(
            "underlyingQueryOrTicker", "Sous-jacent",
            "Aucun sous-jacent (ticker, nom d'entreprise ou thématique) identifiable dans la demande client.",
        ))

    if _is_blank(extraction.get("targetToSolve")):
        flags.append(_flag(
            "targetToSolve", "Variable à résoudre",
            "Aucune variable cible (coupon, barrière, strike...) à résoudre n'a été identifiée dans la demande.",
        ))

    product_type_id = str(extraction.get("productTypeId") or "").upper()
    if product_type_id in _BARRIER_DEPENDENT_PRODUCT_IDS and _is_blank(extraction.get("pdiBarrierPct")):
        flags.append(_flag(
            "pdiBarrierPct", "Barrière PDI / Protection (%)",
            f"Barrière de protection (PDI) non spécifiée pour ce type de produit ({product_type_id or 'inconnu'}).",
        ))

    return flags


def _detect_autocall_v1(extraction: dict) -> list[dict]:
    flags: list[dict] = []

    components = _get(extraction, "underlying.components")
    if _is_blank(components) and _is_blank(extraction.get("underlying")):
        flags.append(_flag("underlying.components", "Sous-jacent(s)", "Aucun sous-jacent identifiable dans la demande."))

    if _is_blank(_get(extraction, "dates.finalValuationDate")) and _is_blank(_get(extraction, "observation.numberOfObservations")):
        flags.append(_flag("dates.finalValuationDate", "Maturité / date de constatation finale",
                           "Ni maturité ni calendrier de constatation exploitable dans la demande."))

    if _is_blank(_get(extraction, "coupon.rate")):
        flags.append(_flag("coupon.rate", "Coupon", "Niveau de coupon non spécifié — à résoudre ou à préciser."))

    protection_type = str(_get(extraction, "finalRedemption.protectionType") or "").upper()
    if protection_type in ("", "CONDITIONAL_PDI") and _is_blank(_get(extraction, "finalRedemption.knockIn.barrier")):
        flags.append(_flag("finalRedemption.knockIn.barrier", "Barrière de protection (PDI)",
                           "Barrière de protection du capital (PDI) non spécifiée."))

    return flags


def _detect_minimal(extraction: dict) -> list[dict]:
    """Fallback check for rich schemas without a dedicated validator yet."""
    flags: list[dict] = []
    has_underlying = any(not _is_blank(extraction.get(k)) for k in ("underlying", "underlyings", "pair", "index"))
    if not has_underlying and _is_blank(_get(extraction, "underlying.components")):
        flags.append(_flag("underlying", "Sous-jacent", "Aucun sous-jacent / indice de référence identifiable dans la demande."))
    if all(_is_blank(_get(extraction, p)) for p in ("maturity_date", "max_maturity_date", "dates.finalValuationDate", "maturityMonths", "maturity_years")):
        flags.append(_flag("maturity", "Maturité", "Maturité non spécifiée dans la demande."))
    return flags


def detect_missing_fields(extraction: dict, schema_version: Optional[str] = None) -> list[dict]:
    if not isinstance(extraction, dict):
        return []
    version = (schema_version or extraction.get("schemaVersion") or "generic/v1").lower()
    if version.startswith("generic"):
        return _detect_generic(extraction)
    if version.startswith("autocall"):
        return _detect_autocall_v1(extraction)
    return _detect_minimal(extraction)
