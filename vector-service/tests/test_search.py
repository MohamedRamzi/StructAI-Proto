LVMH = {"assetClass": "EQUITY", "code": "MC FP", "name": "LVMH", "description": "Leader mondial du luxe europeen.", "tags": ["luxe", "europe"], "metadata": {"sector": "Luxe"}}
TOTAL = {"assetClass": "EQUITY", "code": "FP FP", "name": "TotalEnergies", "description": "Major petroliere energie gaz dividende.", "tags": ["energie"], "metadata": {"sector": "Energie"}}


def _seed(client, auth_headers):
    client.post("/api/instruments", json=LVMH, headers=auth_headers)
    client.post("/api/instruments", json=TOTAL, headers=auth_headers)


def test_search_requires_auth(client):
    res = client.post("/api/instruments/search", json={"query": "luxe"})
    assert res.status_code == 401


def test_search_ranks_the_semantically_closer_instrument_first(client, auth_headers):
    _seed(client, auth_headers)
    res = client.post("/api/instruments/search", json={"query": "luxe europeen marques"}, headers=auth_headers)
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 2
    assert results[0]["code"] == "MC FP"
    assert results[0]["score"] > results[1]["score"]


def test_search_via_a_generated_service_api_key(client, auth_headers):
    _seed(client, auth_headers)
    key_res = client.post("/api/api-keys", json={"label": "main-app"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]
    assert api_key_token.startswith("vsk_")

    res = client.post("/api/instruments/search", json={"query": "energie petroliere"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 200
    assert res.json()["results"][0]["code"] == "FP FP"


def test_search_filters_by_asset_class(client, auth_headers):
    _seed(client, auth_headers)
    res = client.post("/api/instruments/search", json={"query": "luxe", "assetClass": "RATE_INDEX"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["results"] == []


def test_search_returns_a_clear_error_when_the_embedding_call_fails_no_silent_fallback(client, auth_headers, monkeypatch):
    _seed(client, auth_headers)
    from app.services import embeddings as embeddings_module

    def broken_embedding(*args, **kwargs):
        raise RuntimeError("Impossible de contacter Ollama sur http://localhost:11434 : connection refused.")

    monkeypatch.setattr(embeddings_module, "get_embedding", broken_embedding)

    res = client.post("/api/instruments/search", json={"query": "luxe"}, headers=auth_headers)
    assert res.status_code == 502
    body = res.json()
    assert body["success"] is False
    assert "Ollama" in body["error"]


def test_rejects_a_revoked_api_key(client, auth_headers):
    key_res = client.post("/api/api-keys", json={"label": "to-revoke"}, headers=auth_headers)
    api_key_token = key_res.json()["token"]
    key_id = key_res.json()["apiKey"]["id"]

    client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)

    res = client.post("/api/instruments/search", json={"query": "luxe"}, headers={"Authorization": f"Bearer {api_key_token}"})
    assert res.status_code == 401
