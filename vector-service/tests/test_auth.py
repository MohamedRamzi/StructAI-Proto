def test_login_returns_jwt_for_bootstrap_admin(client):
    res = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "admin-test-password"})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["user"] == {"id": 1, "email": "admin@test.local", "role": "admin"}
    assert isinstance(body["token"], str) and body["token"]


def test_login_rejects_wrong_password(client):
    res = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "wrong"})
    assert res.status_code == 401
    assert res.json()["success"] is False


def test_me_requires_auth(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_me_returns_current_user(client, auth_headers):
    res = client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["user"]["email"] == "admin@test.local"


def test_non_admin_blocked_from_user_management(client, auth_headers):
    client.post("/api/users", json={"email": "member@test.local", "password": "member-password", "role": "user"}, headers=auth_headers)
    login = client.post("/api/auth/login", json={"email": "member@test.local", "password": "member-password"})
    member_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    res = client.get("/api/users", headers=member_headers)
    assert res.status_code == 403


def test_admin_cannot_delete_own_account(client, auth_headers):
    me = client.get("/api/auth/me", headers=auth_headers).json()["user"]
    res = client.delete(f"/api/users/{me['id']}", headers=auth_headers)
    assert res.status_code == 400
