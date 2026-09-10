"""
Unit tests for step 1 of the routed pipeline (app/services/routing.py). The
single router LLM call is mocked; we assert on how its JSON is normalized into
classifications, and that a broken/empty router response surfaces as an error
(no silent fallback).
"""
import json

import pytest


@pytest.fixture()
def routing(client, monkeypatch):
    """`client` reimports app.* against a fresh seeded DB; return the routing
    module plus a helper to stub the router LLM call."""
    from app.services import inference_client, routing as routing_module

    def set_response(payload):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        monkeypatch.setattr(inference_client, "chat_completion", lambda system, user, **_: text)

    return routing_module, set_response


def test_classifies_a_single_equity_autocall(routing):
    routing_module, set_response = routing
    set_response({"quotes": [
        {"quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall", "underlying": "MC FP", "routerConfidence": 0.92},
    ]})

    result = routing_module.classify_request("Autocall LVMH 3 ans PDI 70%")
    assert result == [
        {"quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall", "underlying": "MC FP", "routerConfidence": 0.92},
    ]


def test_lowercases_unknown_asset_class_to_none_but_keeps_family(routing):
    routing_module, set_response = routing
    set_response({"quotes": [{"quoteId": 1, "assetClass": "commodities", "productFamily": "swap"}]})

    result = routing_module.classify_request("swap sur pétrole")
    assert result[0]["assetClass"] is None
    assert result[0]["productFamily"] == "swap"
    assert result[0]["routerConfidence"] is None


def test_classifies_a_heterogeneous_multi_quote_request(routing):
    routing_module, set_response = routing
    set_response({"quotes": [
        {"quoteId": 1, "assetClass": "EQUITY", "productFamily": "phoenix", "routerConfidence": 0.9},
        {"quoteId": 2, "assetClass": "RATES", "productFamily": "TARF", "routerConfidence": 0.8},
        {"quoteId": 3, "assetClass": "FX", "productFamily": "xccy swap", "routerConfidence": 0.7},
    ]})

    result = routing_module.classify_request("1) Phoenix ... 2) TARF ... 3) XCCY ...")
    assert [c["quoteId"] for c in result] == [1, 2, 3]
    assert [c["assetClass"] for c in result] == ["EQUITY", "RATES", "FX"]


def test_accepts_a_bare_object_without_a_quotes_key(routing):
    routing_module, set_response = routing
    set_response({"quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall"})

    result = routing_module.classify_request("Autocall LVMH")
    assert len(result) == 1
    assert result[0]["assetClass"] == "EQUITY"


def test_synthesizes_quote_ids_when_the_model_omits_them(routing):
    routing_module, set_response = routing
    set_response({"quotes": [{"assetClass": "EQUITY"}, {"assetClass": "RATES"}]})

    result = routing_module.classify_request("deux cotations")
    assert [c["quoteId"] for c in result] == [1, 2]


def test_raises_when_the_router_returns_no_decodable_json(routing):
    routing_module, set_response = routing
    set_response("désolé, je ne peux pas répondre en JSON")

    with pytest.raises(RuntimeError, match="routage"):
        routing_module.classify_request("Autocall LVMH")


def test_raises_when_the_router_returns_an_empty_quote_list(routing):
    routing_module, set_response = routing
    set_response({"quotes": []})

    with pytest.raises(RuntimeError):
        routing_module.classify_request("blabla")


def test_uses_the_seeded_router_prompt_as_the_system_prompt(routing, monkeypatch):
    routing_module, _ = routing
    from app.services import inference_client

    captured = {}

    def spy(system, user, reasoning_mode=None):
        captured["system"] = system
        captured["user"] = user
        return json.dumps({"quotes": [{"quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall"}]})

    monkeypatch.setattr(inference_client, "chat_completion", spy)
    routing_module.classify_request("Autocall LVMH")

    assert "Classe la demande" in captured["user"]
    assert "Autocall LVMH" in captured["user"]
    # the router seed prompt talks about asset classes
    assert "EQUITY" in captured["system"] or "RATES" in captured["system"]
