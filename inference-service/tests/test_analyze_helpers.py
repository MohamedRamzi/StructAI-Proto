"""Unit tests for the pure-function pieces of services/analyze.py and
services/validation.py — direct ports of quotation-service's llm-client.test.ts
and validation.test.ts."""
from app.services.analyze import extract_json_from_text, normalize_to_raw_quotes
from app.services.validation import detect_missing_fields


class TestExtractJsonFromText:
    def test_parses_a_raw_json_string_directly(self):
        assert extract_json_from_text('{"a": 1}') == {"a": 1}

    def test_strips_think_reasoning_blocks_before_parsing(self):
        raw = "<think>Let me reason about this...</think>\n{\"a\": 1}"
        assert extract_json_from_text(raw) == {"a": 1}

    def test_extracts_json_from_a_json_fenced_code_block(self):
        raw = 'Here is the result:\n```json\n{"a": 1}\n```\nDone.'
        assert extract_json_from_text(raw) == {"a": 1}

    def test_extracts_json_from_a_generic_fenced_code_block(self):
        raw = '```\n{"a": 1}\n```'
        assert extract_json_from_text(raw) == {"a": 1}

    def test_extracts_a_json_object_embedded_in_surrounding_prose(self):
        raw = 'Sure, here is the spec: {"a": 1, "b": [1, 2]} — hope that helps!'
        assert extract_json_from_text(raw) == {"a": 1, "b": [1, 2]}

    def test_extracts_a_json_array_embedded_in_surrounding_prose(self):
        raw = "Results: [1, 2, 3] end."
        assert extract_json_from_text(raw) == [1, 2, 3]

    def test_returns_none_for_empty_or_non_string_input(self):
        assert extract_json_from_text("") is None
        assert extract_json_from_text(None) is None

    def test_returns_none_when_no_valid_json_can_be_decoded(self):
        assert extract_json_from_text("this is not json at all") is None


class TestNormalizeToRawQuotes:
    def test_wraps_a_single_object_without_a_quotes_key(self):
        assert normalize_to_raw_quotes({"productTypeId": "AUTOCALL_CLASSIC"}) == [{"productTypeId": "AUTOCALL_CLASSIC"}]

    def test_returns_the_quotes_array_when_present(self):
        payload = {"quotes": [{"quoteId": 1}, {"quoteId": 2}]}
        assert normalize_to_raw_quotes(payload) == [{"quoteId": 1}, {"quoteId": 2}]

    def test_wraps_a_single_quotes_object_into_a_list(self):
        payload = {"quotes": {"quoteId": 1}}
        assert normalize_to_raw_quotes(payload) == [{"quoteId": 1}]

    def test_passes_through_a_bare_list(self):
        assert normalize_to_raw_quotes([{"quoteId": 1}]) == [{"quoteId": 1}]

    def test_returns_empty_list_for_falsy_input(self):
        assert normalize_to_raw_quotes(None) == []
        assert normalize_to_raw_quotes({}) == []


class TestDetectMissingFields:
    def test_flags_maturity_months_as_missing_when_null_or_absent(self):
        flags = detect_missing_fields({"maturityMonths": None, "underlyingQueryOrTicker": "MC FP", "targetToSolve": "COUPON_RATE"})
        assert any(f["field"] == "maturityMonths" for f in flags)

        flags = detect_missing_fields({"underlyingQueryOrTicker": "MC FP", "targetToSolve": "COUPON_RATE"})
        assert any(f["field"] == "maturityMonths" for f in flags)

    def test_does_not_flag_maturity_months_when_a_valid_number_is_present(self):
        flags = detect_missing_fields({"maturityMonths": 36, "underlyingQueryOrTicker": "MC FP", "targetToSolve": "COUPON_RATE"})
        assert not any(f["field"] == "maturityMonths" for f in flags)

    def test_flags_a_missing_underlying(self):
        flags = detect_missing_fields({"maturityMonths": 36, "underlyingQueryOrTicker": "", "targetToSolve": "COUPON_RATE"})
        assert any(f["field"] == "underlyingQueryOrTicker" for f in flags)

    def test_flags_a_missing_target_to_solve(self):
        flags = detect_missing_fields({"maturityMonths": 36, "underlyingQueryOrTicker": "MC FP"})
        assert any(f["field"] == "targetToSolve" for f in flags)

    def test_flags_a_missing_pdi_barrier_for_barrier_dependent_products(self):
        flags = detect_missing_fields({
            "productTypeId": "AUTOCALL_CLASSIC",
            "maturityMonths": 36,
            "underlyingQueryOrTicker": "MC FP",
            "targetToSolve": "COUPON_RATE",
        })
        assert any(f["field"] == "pdiBarrierPct" for f in flags)

    def test_does_not_flag_pdi_barrier_for_products_that_do_not_need_one(self):
        flags = detect_missing_fields({
            "productTypeId": "CAPITAL_PROTECTED_NOTE",
            "maturityMonths": 36,
            "underlyingQueryOrTicker": "MC FP",
            "targetToSolve": "COUPON_RATE",
        })
        assert not any(f["field"] == "pdiBarrierPct" for f in flags)

    def test_returns_no_flags_for_a_fully_specified_extraction(self):
        flags = detect_missing_fields({
            "productTypeId": "AUTOCALL_CLASSIC",
            "maturityMonths": 36,
            "underlyingQueryOrTicker": "MC FP",
            "targetToSolve": "COUPON_RATE",
            "pdiBarrierPct": 70,
        })
        assert flags == []
