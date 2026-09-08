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
