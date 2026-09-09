"""GET/PUT /api/config/llm and /api/config/embedding — role-based access,
mirroring quotation-service's and vector-service's config tests."""


def test_non_admin_can_read_but_not_write_llm_config(client, auth_headers):
    client.post("/api/users", json={"email": "member@test.local", "password": "member-password", "role": "user"}, headers=auth_headers)
    login = client.post("/api/auth/login", json={"email": "member@test.local", "password": "member-password"})
    member_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    get_res = client.get("/api/config/llm", headers=member_headers)
    assert get_res.status_code == 200

    put_res = client.put("/api/config/llm", json={"model": "some-model"}, headers=member_headers)
    assert put_res.status_code == 403


def test_admin_updates_llm_config(client, auth_headers):
    res = client.put("/api/config/llm", json={"model": "Qwen/Qwen3-4B-Instruct-2507", "baseUrl": "http://localhost:8001/v1", "temperature": 0.2}, headers=auth_headers)
    assert res.status_code == 200
    cfg = res.json()["config"]
    assert cfg["model"] == "Qwen/Qwen3-4B-Instruct-2507"
    assert cfg["temperature"] == 0.2


def test_llm_config_rejects_out_of_range_temperature(client, auth_headers):
    res = client.put("/api/config/llm", json={"temperature": 5}, headers=auth_headers)
    assert res.status_code == 400


def test_llm_config_defaults_to_openai_compatible_provider_with_no_key(client, auth_headers):
    res = client.get("/api/config/llm", headers=auth_headers)
    cfg = res.json()["config"]
    assert cfg["provider"] == "openai_compatible"
    assert cfg["hasApiKey"] is False


def test_llm_config_rejects_an_unknown_provider(client, auth_headers):
    res = client.put("/api/config/llm", json={"provider": "carrier-pigeon"}, headers=auth_headers)
    assert res.status_code == 400


def test_llm_config_can_switch_to_gemini_with_an_api_key_without_ever_returning_it(client, auth_headers):
    res = client.put("/api/config/llm", json={"provider": "gemini", "model": "gemini-2.5-flash", "apiKey": "AIza-secret-key"}, headers=auth_headers)
    assert res.status_code == 200
    cfg = res.json()["config"]
    assert cfg["provider"] == "gemini"
    assert cfg["hasApiKey"] is True
    assert "apiKey" not in cfg
    assert "AIza-secret-key" not in res.text  # the raw key must never round-trip through the API

    # A subsequent GET must not leak it either.
    get_res = client.get("/api/config/llm", headers=auth_headers)
    assert "AIza-secret-key" not in get_res.text
    assert get_res.json()["config"]["hasApiKey"] is True


def test_llm_config_omitting_api_key_keeps_the_existing_one(client, auth_headers):
    client.put("/api/config/llm", json={"provider": "gemini", "apiKey": "AIza-secret-key"}, headers=auth_headers)
    res = client.put("/api/config/llm", json={"temperature": 0.3}, headers=auth_headers)
    assert res.json()["config"]["hasApiKey"] is True


def test_llm_config_empty_string_api_key_clears_it(client, auth_headers):
    client.put("/api/config/llm", json={"provider": "gemini", "apiKey": "AIza-secret-key"}, headers=auth_headers)
    res = client.put("/api/config/llm", json={"apiKey": ""}, headers=auth_headers)
    assert res.json()["config"]["hasApiKey"] is False


def test_admin_updates_embedding_config(client, auth_headers):
    res = client.put("/api/config/embedding", json={"model": "Qwen/Qwen3-Embedding-0.6B", "baseUrl": "http://localhost:8002/v1"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["config"]["model"] == "Qwen/Qwen3-Embedding-0.6B"


def test_embedding_config_requires_admin_to_write(client, auth_headers):
    client.post("/api/users", json={"email": "member2@test.local", "password": "member-password", "role": "user"}, headers=auth_headers)
    login = client.post("/api/auth/login", json={"email": "member2@test.local", "password": "member-password"})
    member_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    res = client.put("/api/config/embedding", json={"model": "x"}, headers=member_headers)
    assert res.status_code == 403
