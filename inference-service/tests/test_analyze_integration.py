"""
Integration tests for POST /api/analyze (the routed pipeline). Every LLM call
— the router step AND the per-scope extraction step — is mocked via
app.services.inference_client.chat_completion; never a real inference engine,
matching the project-wide principle.

The mock distinguishes the two steps by the user prompt: the router step's
user prompt contains "Classe la demande".
"""
import json


# Flat generic/v1 extraction — the mock always tags its output with an explicit
# schemaVersion so detect_missing_fields uses the matching validator regardless
# of which pre-prompt the router routed to.
GENERIC_EXTRACTION = {
    "quoteId": 1,
    "label": "Autocall Classic",
    "schemaVersion": "generic/v1",
    "productTypeId": "AUTOCALL_CLASSIC",
    "productTypeName": "Autocall Classic",
    "productFamily": "YIELD_ENHANCEMENT",
    "targetToSolve": "COUPON_RATE",
    "underlyingQueryOrTicker": "MC FP",
    "maturityMonths": 36,
    "forwardStartMonths": 0,
    "observationFrequency": "QUARTERLY",
    "nonCallMonths": 12,
    "currency": "EUR",
    "autocallBarrierPct": 100,
    "pdiBarrierPct": 70,
    "memoryCoupon": True,
    "confidenceScore": 0.9,
    "aiExplanation": "test",
}

ROUTER_EQUITY_AUTOCALL = {
    "quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall",
    "underlying": "MC FP", "routerConfidence": 0.9,
}


def make_fake_chat(router_quotes, extraction_quotes):
    def fake(system, user):
        if "Classe la demande" in user:
            return json.dumps({"quotes": router_quotes})
        return json.dumps({"quotes": extraction_quotes})
    return fake


def _api_key(client, auth_headers, label):
    return client.post("/api/api-keys", json={"label": label}, headers=auth_headers).json()["token"]


def test_creates_an_api_key_and_uses_it_to_call_analyze_successfully(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    token = _api_key(client, auth_headers, "test-key")
    assert token.startswith("isk_")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["pipeline"] == "routed"
    quote = body["quotes"][0]
    assert quote["extraction"]["maturityMonths"] == 36
    assert quote["missingFields"] == []
    # routing metadata is attached
    assert quote["routing"]["assetClass"] == "EQUITY"
    assert quote["routing"]["productFamily"] == "autocall"
    assert quote["routing"]["promptKey"] == "equity-autocall"
    assert quote["routing"]["scopePrecision"] == 3


def test_confidence_is_weighted_by_scope_precision(client, auth_headers, monkeypatch):
    from app.services import inference_client

    # Route to something that only resolves at precision 2 (equity, no family match).
    router = {"quoteId": 1, "assetClass": "EQUITY", "productFamily": "call spread", "routerConfidence": 0.8}
    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([router], [GENERIC_EXTRACTION]))
    token = _api_key(client, auth_headers, "k")

    res = client.post("/api/analyze", json={"query": "call spread LVMH"}, headers={"Authorization": f"Bearer {token}"})
    quote = res.json()["quotes"][0]
    assert quote["routing"]["scopePrecision"] == 2
    # 0.9 (model) * 0.9 (precision-2 factor) = 0.81
    assert quote["extraction"]["confidenceScore"] == 0.81


def test_flags_a_missing_maturity_instead_of_silently_defaulting_it(client, auth_headers, monkeypatch):
    from app.services import inference_client

    extraction = {**GENERIC_EXTRACTION, "maturityMonths": None}
    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [extraction]))
    token = _api_key(client, auth_headers, "test-key-2")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70%"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    quote = res.json()["quotes"][0]
    assert quote["extraction"]["maturityMonths"] is None
    assert any(f["field"] == "maturityMonths" for f in quote["missingFields"])


def test_autocall_v1_schema_missing_fields_use_the_nested_validator(client, auth_headers, monkeypatch):
    from app.services import inference_client

    autocall_v1 = {
        "quoteId": 1, "label": "Athena LVMH",
        "schemaVersion": "autocall/v1", "productFamily": "ATHENA",
        "underlying": {"components": [{"name": "LVMH"}]},
        "dates": {"finalValuationDate": "2036-09-22"},
        "coupon": {"rate": 0.08},
        "finalRedemption": {"protectionType": "CONDITIONAL_PDI", "knockIn": {"barrier": None}},
        "confidenceScore": 0.9,
    }
    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [autocall_v1]))
    token = _api_key(client, auth_headers, "k")

    res = client.post("/api/analyze", json={"query": "Athena LVMH 10 ans coupon 8%"}, headers={"Authorization": f"Bearer {token}"})
    quote = res.json()["quotes"][0]
    assert quote["schemaVersion"] == "autocall/v1"
    assert any(f["field"] == "finalRedemption.knockIn.barrier" for f in quote["missingFields"])


def test_single_pipeline_skips_the_router(client, auth_headers, monkeypatch):
    from app.services import inference_client

    calls = []

    def fake(system, user):
        calls.append(user)
        return json.dumps({"quotes": [GENERIC_EXTRACTION]})

    monkeypatch.setattr(inference_client, "chat_completion", fake)
    token = _api_key(client, auth_headers, "k")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH 3 ans", "pipeline": "single"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["pipeline"] == "single"
    assert len(calls) == 1  # extraction only, no router call
    assert not any("Classe la demande" in c for c in calls)
    assert body["quotes"][0]["routing"]["promptKey"] == "default"


def test_heterogeneous_request_routes_each_quote_and_merges(client, auth_headers, monkeypatch):
    from app.services import inference_client

    router_quotes = [
        {"quoteId": 1, "assetClass": "EQUITY", "productFamily": "autocall", "routerConfidence": 0.9},
        {"quoteId": 2, "assetClass": "RATES", "productFamily": "tarf", "routerConfidence": 0.85},
    ]

    def fake(system, user):
        if "Classe la demande" in user:
            return json.dumps({"quotes": router_quotes})
        if "EQUITY" in user or "autocall" in user:
            return json.dumps({"quotes": [{**GENERIC_EXTRACTION, "quoteId": 1, "label": "Q1 equity"}]})
        return json.dumps({"quotes": [{"quoteId": 2, "label": "Q2 rates", "schemaVersion": "rates/v1", "product_type": "TARF", "confidenceScore": 0.7}]})

    monkeypatch.setattr(inference_client, "chat_completion", fake)
    token = _api_key(client, auth_headers, "k")

    res = client.post("/api/analyze", json={"query": "Cotation 1: Autocall LVMH | Cotation 2: TARF EURUSD"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    quotes = res.json()["quotes"]
    assert len(quotes) == 2
    assert quotes[0]["routing"]["promptKey"] == "equity-autocall"
    assert quotes[1]["routing"]["promptKey"] == "rates"
    assert quotes[1]["schemaVersion"] == "rates/v1"


def test_returns_a_clear_error_no_silent_fallback_when_the_llm_fails(client, auth_headers, monkeypatch):
    from app.services import inference_client

    def broken(system, user):
        raise RuntimeError("Le moteur de chat ne répond pas (500) sur http://localhost:8001/v1/chat/completions.")

    monkeypatch.setattr(inference_client, "chat_completion", broken)
    token = _api_key(client, auth_headers, "test-key-fail")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 500
    assert res.json()["success"] is False


def test_returns_a_clear_error_when_the_router_returns_no_json(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user: "this is not json at all")
    token = _api_key(client, auth_headers, "test-key-badjson")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 500
    assert res.json()["success"] is False


def test_rejects_a_revoked_api_key(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    key_res = client.post("/api/api-keys", json={"label": "to-revoke"}, headers=auth_headers)
    token = key_res.json()["token"]
    key_id = key_res.json()["apiKey"]["id"]
    client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_rejects_a_request_with_no_query(client, auth_headers):
    token = _api_key(client, auth_headers, "test-key-3")
    res = client.post("/api/analyze", json={}, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400
