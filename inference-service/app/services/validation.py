"""
Flags fields the LLM failed to extract from a client request, so callers (the
main StructAI app's UI) can surface "please clarify X" to the user instead of
silently defaulting or guessing a value — e.g. "absence de maturité dans la
requête". Direct Python port of quotation-service's validation.ts.
"""

# Product families/types whose payoff depends on a PDI (protection) barrier.
BARRIER_DEPENDENT_PRODUCT_IDS = {
    "AUTOCALL_CLASSIC",
    "PHOENIX_MEMORY",
    "AUTOCALL_AIRBAG",
    "REVERSE_CONVERTIBLE",
}


def detect_missing_fields(extraction: dict) -> list[dict]:
    flags: list[dict] = []

    maturity = extraction.get("maturityMonths")
    if maturity is None or maturity == "":
        flags.append({
            "field": "maturityMonths",
            "label": "Maturité totale (mois)",
            "message": "Maturité non spécifiée dans la demande client.",
        })

    underlying = extraction.get("underlyingQueryOrTicker")
    if not underlying or str(underlying).strip() == "":
        flags.append({
            "field": "underlyingQueryOrTicker",
            "label": "Sous-jacent",
            "message": "Aucun sous-jacent (ticker, nom d'entreprise ou thématique) identifiable dans la demande client.",
        })

    target = extraction.get("targetToSolve")
    if not target or str(target).strip() == "":
        flags.append({
            "field": "targetToSolve",
            "label": "Variable à résoudre",
            "message": "Aucune variable cible (coupon, barrière, strike...) à résoudre n'a été identifiée dans la demande.",
        })

    product_type_id = str(extraction.get("productTypeId") or "").upper()
    if product_type_id in BARRIER_DEPENDENT_PRODUCT_IDS:
        pdi = extraction.get("pdiBarrierPct")
        if pdi is None or pdi == "":
            flags.append({
                "field": "pdiBarrierPct",
                "label": "Barrière PDI / Protection (%)",
                "message": f"Barrière de protection (PDI) non spécifiée pour ce type de produit ({product_type_id or 'inconnu'}).",
            })

    return flags
