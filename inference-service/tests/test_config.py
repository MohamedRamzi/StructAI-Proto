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


def test_config_presets_endpoint_returns_chat_and_embedding_lists(client, auth_headers):
    res = client.get("/api/config/presets", headers=auth_headers)
    assert res.status_code == 200
    presets = res.json()["presets"]
    assert isinstance(presets["chat"], list) and len(presets["chat"]) >= 1
    assert isinstance(presets["embedding"], list) and len(presets["embedding"]) >= 1
    # every chat preset carries what the form needs
    for p in presets["chat"]:
        assert p["provider"] in ("openai_compatible", "gemini")
        assert "model" in p and "baseUrl" in p
    # a local vLLM preset is offered (the point of the feature: no retyping)
    assert any(p["provider"] == "openai_compatible" and "8001" in p["baseUrl"] for p in presets["chat"])


def test_config_presets_require_auth(client):
    assert client.get("/api/config/presets").status_code == 401


def test_config_presets_prefers_the_json_file_when_present(client, auth_headers, tmp_path, monkeypatch):
    import json as _json
    from app import config as config_module
    from app.routers import llm_config

    custom = tmp_path / "llm-presets.json"
    custom.write_text(_json.dumps({
        "chat": [{"label": "Mon endpoint perso", "provider": "openai_compatible", "model": "my-model", "baseUrl": "http://host:9999/v1", "temperature": 0.0}],
        "embedding": [],
    }), encoding="utf-8")
    monkeypatch.setattr(config_module, "LLM_PRESETS_PATH", custom)
    monkeypatch.setattr(llm_config.config, "LLM_PRESETS_PATH", custom)

    res = client.get("/api/config/presets", headers=auth_headers)
    labels = [p["label"] for p in res.json()["presets"]["chat"]]
    assert labels == ["Mon endpoint perso"]


def test_config_presets_fall_back_to_builtin_on_a_broken_file(client, auth_headers, tmp_path, monkeypatch):
    from app import config as config_module
    from app.routers import llm_config

    broken = tmp_path / "llm-presets.json"
    broken.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(llm_config.config, "LLM_PRESETS_PATH", broken)

    res = client.get("/api/config/presets", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["presets"] == config_module.BUILTIN_LLM_PRESETS
