"""
Step 2 of the routed-analyze pipeline: given the (assetClass, productFamily)
the router returned, pick the domain pre-prompt to use for extraction — by a
DETERMINISTIC cascade, no extra LLM call:

    {family}-{class}   (scope precision 3)  ->  {class}   (2)  ->  default   (1)

The router's `productFamily` is free text; normalize_family() maps it to a
canonical key first (ATHENA/PHOENIX/AIRBAG/... all collapse to "autocall").
The scope precision is returned so services/analyze.py can weight the final
confidence: the more specific the prompt that matched, the more we trust the
extraction it produced.
"""
from typing import Optional

from .. import db

# Raw family label (upper-cased, non-alnum stripped) -> canonical family key.
_FAMILY_ALIASES: dict[str, str] = {}


def _register(canonical: str, *aliases: str) -> None:
    _FAMILY_ALIASES[canonical.upper()] = canonical
    for alias in aliases:
        _FAMILY_ALIASES["".join(ch for ch in alias.upper() if ch.isalnum())] = canonical


# --- EQUITY ---
_register(
    "autocall",
    "autocall", "autocallable", "athena", "phoenix", "phoenixmemory", "airbag", "athenaairbag",
    "yeti", "yetiphoenix", "himalaya", "magnet", "altiplano", "bestof", "worstof", "bestworst",
    "reverseconvertible", "reverse convertible", "arc", "brc", "barrierreverseconvertible",
    "autocallreverseconvertible", "twinwin", "twinwinautocall", "booster", "boosterautocall",
    "express", "snowballcoupon", "callablenote", "athenacapitalprotected", "stepdown",
)
_register("vanilla", "vanilla", "call", "put", "option", "tunnel", "collar", "participation", "outperformance")

# --- RATES ---
_register("tarf", "tarf", "targetaccrualredemptionforward")
_register("tarn", "tarn", "targetaccrualredemptionnote")
_register("range_accrual", "rangeaccrual", "range", "accrualswap", "rangenote", "dualrangeaccrual", "dualrange")
_register("cms_spread", "cmsspread", "cms", "steepener", "flattener", "cmssteepener", "curvesteepener")
_register("rate_autocall", "rateautocall", "autocalltaux")
_register("snowball", "snowball", "snowballaccrual")
_register("formosa", "formosa", "formosabond")
_register("prdc", "prdc", "powerreversedualcurrency")
_register("ir_swap", "irswap", "irs", "swap", "interestrateswap", "capfloorcollar", "cap", "floor", "collar", "swaption", "irsstructured")

# --- FX ---
_register("fx_swap", "fxswap", "forwardfx", "fxforward")
_register("xccy_swap", "xccyswap", "crosscurrencyswap", "crosscurrency")
_register("fx_option", "fxoption", "dualcurrencydeposit", "fxlinkednote", "fxlinked")

# --- CREDIT ---
# Not currently routable (CREDIT is deprioritized — see router.md), but the
# family taxonomy and this domain prompt are kept for when it's picked back up.
_register("credit_linked", "creditlinkednote", "cln", "creditlinked")
_register("tranche", "tranchenote", "tranche", "cdo", "synthcdo")


def normalize_family(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    compact = "".join(ch for ch in str(raw).upper() if ch.isalnum())
    if not compact:
        return None
    return _FAMILY_ALIASES.get(compact) or str(raw).strip().lower().replace(" ", "_")


def resolve(asset_class: Optional[str], product_family: Optional[str]) -> dict:
    """Returns {promptKey, promptBody, scopePrecision, assetClass, productFamily}.
    scopePrecision: 3 = matched {family}-{class}, 2 = matched {class}, 1 = default."""
    ac = (asset_class or "").upper() or None
    canonical_family = normalize_family(product_family)

    if ac and canonical_family:
        row = db.find_domain_prompt(ac, canonical_family)
        if row:
            return _result(row, 3, ac, canonical_family)

    if ac:
        row = db.find_domain_prompt(ac, None)
        if row:
            return _result(row, 2, ac, canonical_family)

    fallback = db.get_prompt("default")
    if fallback is None:
        raise RuntimeError(
            "Aucun pré-prompt 'default' en base — le seed des prompts a échoué. "
            "Vérifiez inference-service/prompts/default.md."
        )
    return _result(fallback, 1, ac, canonical_family)


def _result(row: dict, precision: int, asset_class: Optional[str], family: Optional[str]) -> dict:
    return {
        "promptKey": row["key"],
        "promptBody": row["body"],
        "scopePrecision": precision,
        "assetClass": asset_class,
        "productFamily": family,
    }
