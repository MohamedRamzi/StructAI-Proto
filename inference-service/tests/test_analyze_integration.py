"""
Integration tests for POST /api/analyze, mirroring quotation-service's
api.integration.test.ts. The vLLM chat sidecar is always mocked
(app.services.inference_client.chat_completion) — never a real `vllm serve`
process, in tests or CI, matching the project-wide "no real inference engine
in automated tests" principle already applied to Gemini/Ollama/vLLM alike.
"""
import json


FULL_EXTRACTION = {
    "quoteId": 1,
    "label": "Autocall Classic",
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


def _fake_chat_completion(quotes):
    return json.dumps({"quotes": quotes})


def test_creates_an_api_key_and_uses_it_to_call_analyze_successfully(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user: _fake_chat_completion([FULL_EXTRACTION]))

    key_res = client.post("/api/api-keys", json={"label": "test-key"}, headers=auth_headers)
    assert key_res.status_code == 201
    api_key_token = key_res.json()["token"]
    assert api_key_token.startswith("isk_")

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["quotes"][0]["extraction"]["maturityMonths"] == 36
    assert body["quotes"][0]["missingFields"] == []


def test_flags_a_missing_maturity_instead_of_silently_defaulting_it(client, auth_headers, monkeypatch):
    from app.services import inference_client

    extraction = {**FULL_EXTRACTION, "maturityMonths": None}
    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user: _fake_chat_completion([extraction]))

    key_res = client.post("/api/api-keys", json={"label": "test-key-2"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70%"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["quotes"][0]["extraction"]["maturityMonths"] is None
    assert any(f["field"] == "maturityMonths" for f in body["quotes"][0]["missingFields"])


def test_returns_a_clear_error_no_silent_fallback_when_the_sidecar_itself_fails(client, auth_headers, monkeypatch):
    from app.services import inference_client

    def broken(system, user):
        raise RuntimeError('Le moteur de chat (vLLM) ne répond pas (500) sur http://localhost:8001/v1/chat/completions.')

    monkeypatch.setattr(inference_client, "chat_completion", broken)

    key_res = client.post("/api/api-keys", json={"label": "test-key-fail"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 500
    body = res.json()
    assert body["success"] is False
    assert len(body["error"]) > 0


def test_returns_a_clear_error_when_the_sidecar_returns_no_json_no_silent_fallback(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user: "this is not json at all")

    key_res = client.post("/api/api-keys", json={"label": "test-key-badjson"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 500
    assert res.json()["success"] is False


def test_rejects_a_revoked_api_key(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user: _fake_chat_completion([FULL_EXTRACTION]))

    key_res = client.post("/api/api-keys", json={"label": "to-revoke"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]
    key_id = key_res.json()["apiKey"]["id"]

    client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)

    res = client.post("/api/analyze", json={"query": "Autocall LVMH PDI 70% 3 ans"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 401


def test_rejects_a_request_with_no_query(client, auth_headers):
    key_res = client.post("/api/api-keys", json={"label": "test-key-3"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]

    res = client.post("/api/analyze", json={}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 400
