"""
Unit tests for the deterministic prompt-resolution cascade
(app/services/prompt_resolver.py):

    {family}-{class}  (precision 3)  ->  {class}  (2)  ->  default  (1)

The `client` fixture is depended upon only for its side effect: it reimports
the `app.*` package against a fresh tmp DB and seeds the `prompts` table from
inference-service/prompts/*.md. We then call the resolver directly.
"""
import pytest

from app.services import prompt_resolver
from app.services.prompt_resolver import normalize_family


@pytest.fixture(autouse=True)
def _seeded_db(client):
    """Every test here needs the seeded prompts table."""
    return client


class TestNormalizeFamily:
    def test_maps_equity_autocall_aliases_to_the_canonical_key(self):
        for raw in ("ATHENA", "Phoenix", "airbag", "Autocallable", "reverse convertible"):
            assert normalize_family(raw) == "autocall"

    def test_maps_rates_aliases(self):
        assert normalize_family("TARF") == "tarf"
        assert normalize_family("range accrual") == "range_accrual"
        assert normalize_family("CMS spread") == "cms_spread"

    def test_unknown_family_is_slugified_not_dropped(self):
        assert normalize_family("Some Exotic Thing") == "some_exotic_thing"

    def test_blank_input_returns_none(self):
        assert normalize_family(None) is None
        assert normalize_family("") is None
        assert normalize_family("   ") is None


class TestResolveCascade:
    def test_precision_3_when_family_and_class_both_match(self):
        res = prompt_resolver.resolve("EQUITY", "Athena")
        assert res["promptKey"] == "equity-autocall"
        assert res["scopePrecision"] == 3
        assert res["assetClass"] == "EQUITY"
        assert res["productFamily"] == "autocall"
        assert res["promptBody"]

    def test_precision_2_when_only_the_asset_class_matches(self):
        res = prompt_resolver.resolve("EQUITY", "call spread")
        assert res["promptKey"] == "equity"
        assert res["scopePrecision"] == 2
        # canonical family is still surfaced even though no family prompt matched
        assert res["productFamily"] == "call_spread"

    def test_precision_2_for_rates_without_a_family_prompt(self):
        res = prompt_resolver.resolve("RATES", "something-unseeded")
        assert res["promptKey"] == "rates"
        assert res["scopePrecision"] == 2

    def test_precision_1_default_when_asset_class_is_unknown(self):
        res = prompt_resolver.resolve(None, "autocall")
        assert res["promptKey"] == "default"
        assert res["scopePrecision"] == 1

    def test_precision_1_default_when_asset_class_has_no_class_prompt(self):
        # A class with neither a family nor a class-level prompt seeded.
        res = prompt_resolver.resolve("COMMODITY", "swap")
        assert res["promptKey"] == "default"
        assert res["scopePrecision"] == 1

    def test_rates_tarf_resolves_to_the_rates_class_prompt_at_precision_2(self):
        # No rates-tarf prompt is seeded yet, so the cascade stops at the class level.
        res = prompt_resolver.resolve("RATES", "TARF")
        assert res["promptKey"] == "rates"
        assert res["scopePrecision"] == 2
        assert res["productFamily"] == "tarf"
