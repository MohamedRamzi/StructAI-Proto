"""
CRUD + RBAC for /api/prompts (the routed-analyze pipeline's prompt store) and
the file-based seed.

- any authenticated user may read; only an admin may write/delete
- the seeded router / _common / default rows are protected: editable, but
  their `kind` can't change and they can't be deleted
- the seed is idempotent and runs on every boot (already exercised by the
  `client` fixture reimporting the app against a fresh DB)
"""
import pytest


@pytest.fixture()
def member_headers(client, auth_headers):
    client.post(
        "/api/users",
        json={"email": "member@test.local", "password": "member-password", "role": "user"},
        headers=auth_headers,
    )
    token = client.post(
        "/api/auth/login", json={"email": "member@test.local", "password": "member-password"}
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_seed_populates_the_eight_prompt_rows(client, auth_headers):
    res = client.get("/api/prompts", headers=auth_headers)
    assert res.status_code == 200
    keys = {p["key"] for p in res.json()["prompts"]}
    assert {"router", "_common", "default", "equity", "equity-autocall", "rates", "fx", "credit"}.issubset(keys)


def test_seeded_protected_rows_are_flagged(client, auth_headers):
    prompts = {p["key"]: p for p in client.get("/api/prompts", headers=auth_headers).json()["prompts"]}
    assert prompts["router"]["isProtected"] is True
    assert prompts["_common"]["isProtected"] is True
    assert prompts["default"]["isProtected"] is True
    assert prompts["equity-autocall"]["isProtected"] is False


def test_router_seed_carries_the_asset_class_disambiguation_guidance(client, auth_headers):
    """The router must not classify an equity underlying whose name contains
    "Crédit" (Crédit Agricole, ...) as the CREDIT asset class — regression guard
    for that guidance being dropped from prompts/router.md."""
    body = client.get("/api/prompts/router", headers=auth_headers).json()["prompt"]["body"]
    assert "Pièges à éviter" in body
    assert "Crédit Agricole" in body


def test_get_single_prompt_returns_its_body(client, auth_headers):
    res = client.get("/api/prompts/equity-autocall", headers=auth_headers)
    assert res.status_code == 200
    prompt = res.json()["prompt"]
    assert prompt["assetClass"] == "EQUITY"
    assert prompt["productFamily"] == "autocall"
    assert prompt["body"].strip()


def test_get_unknown_prompt_returns_404(client, auth_headers):
    assert client.get("/api/prompts/nope", headers=auth_headers).status_code == 404


def test_read_requires_authentication(client):
    assert client.get("/api/prompts").status_code == 401
    assert client.get("/api/prompts/router").status_code == 401


def test_member_can_read_but_not_write(client, member_headers):
    assert client.get("/api/prompts", headers=member_headers).status_code == 200
    res = client.put(
        "/api/prompts/equity-vanilla",
        json={"name": "x", "kind": "domain", "assetClass": "EQUITY", "productFamily": "vanilla", "body": "corps"},
        headers=member_headers,
    )
    assert res.status_code == 403


def test_admin_can_create_a_new_domain_prompt(client, auth_headers):
    res = client.put(
        "/api/prompts/equity-vanilla",
        json={
            "name": "Actions — Vanille",
            "kind": "domain",
            "assetClass": "equity",
            "productFamily": "Vanilla",
            "scopeDescription": "Calls/puts vanille sur actions.",
            "body": "Tu es un extracteur de specs d'options vanille.",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    prompt = res.json()["prompt"]
    assert prompt["assetClass"] == "EQUITY"  # normalized
    assert prompt["productFamily"] == "vanilla"
    assert prompt["isProtected"] is False

    # and it now participates in the resolution cascade at precision 3
    from app.services import prompt_resolver

    res2 = prompt_resolver.resolve("EQUITY", "vanilla")
    assert res2["promptKey"] == "equity-vanilla"
    assert res2["scopePrecision"] == 3


def test_admin_can_edit_a_protected_prompt_body(client, auth_headers):
    current = client.get("/api/prompts/default", headers=auth_headers).json()["prompt"]
    res = client.put(
        "/api/prompts/default",
        json={
            "name": current["name"],
            "kind": current["kind"],
            "assetClass": current["assetClass"],
            "productFamily": current["productFamily"],
            "scopeDescription": current["scopeDescription"],
            "body": current["body"] + "\n\nNote ajoutée par l'admin.",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.json()["prompt"]["body"].endswith("Note ajoutée par l'admin.")
    assert res.json()["prompt"]["isProtected"] is True


def test_cannot_change_the_kind_of_a_protected_prompt(client, auth_headers):
    res = client.put(
        "/api/prompts/router",
        json={"name": "Routage", "kind": "domain", "body": "corps"},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_rejects_an_invalid_kind(client, auth_headers):
    res = client.put(
        "/api/prompts/whatever",
        json={"name": "x", "kind": "banana", "body": "corps"},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_rejects_an_invalid_asset_class(client, auth_headers):
    res = client.put(
        "/api/prompts/whatever",
        json={"name": "x", "kind": "domain", "assetClass": "CRYPTO", "body": "corps"},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_admin_can_delete_a_non_protected_prompt(client, auth_headers):
    client.put(
        "/api/prompts/equity-vanilla",
        json={"name": "v", "kind": "domain", "assetClass": "EQUITY", "productFamily": "vanilla", "body": "corps"},
        headers=auth_headers,
    )
    assert client.delete("/api/prompts/equity-vanilla", headers=auth_headers).status_code == 204
    assert client.get("/api/prompts/equity-vanilla", headers=auth_headers).status_code == 404


def test_cannot_delete_a_protected_prompt(client, auth_headers):
    for key in ("router", "_common", "default"):
        assert client.delete(f"/api/prompts/{key}", headers=auth_headers).status_code == 400
        assert client.get(f"/api/prompts/{key}", headers=auth_headers).status_code == 200


def test_member_cannot_delete(client, member_headers):
    assert client.delete("/api/prompts/equity-autocall", headers=member_headers).status_code == 403


def test_reset_restores_a_prompt_from_its_seed_file(client, auth_headers):
    original = client.get("/api/prompts/equity-autocall", headers=auth_headers).json()["prompt"]["body"]

    client.put(
        "/api/prompts/equity-autocall",
        json={"name": "x", "kind": "domain", "assetClass": "EQUITY", "productFamily": "autocall", "body": "CORPS BIDON"},
        headers=auth_headers,
    )
    assert client.get("/api/prompts/equity-autocall", headers=auth_headers).json()["prompt"]["body"] == "CORPS BIDON"

    res = client.post("/api/prompts/equity-autocall/reset", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["prompt"]["body"] == original
    assert client.get("/api/prompts/equity-autocall", headers=auth_headers).json()["prompt"]["body"] == original


def test_reset_works_on_a_protected_prompt(client, auth_headers):
    client.put("/api/prompts/default", json={"name": "d", "kind": "domain", "body": "bidon"}, headers=auth_headers)
    res = client.post("/api/prompts/default/reset", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["prompt"]["isProtected"] is True
    assert res.json()["prompt"]["body"] != "bidon"


def test_reset_404_for_a_key_with_no_seed_file(client, auth_headers):
    client.put(
        "/api/prompts/equity-vanilla",
        json={"name": "v", "kind": "domain", "assetClass": "EQUITY", "productFamily": "vanilla", "body": "corps"},
        headers=auth_headers,
    )
    res = client.post("/api/prompts/equity-vanilla/reset", headers=auth_headers)
    assert res.status_code == 404


def test_reset_requires_admin(client, member_headers):
    assert client.post("/api/prompts/equity-autocall/reset", headers=member_headers).status_code == 403


def test_seed_does_not_overwrite_an_admin_edit_on_reboot(client, auth_headers, tmp_path, monkeypatch):
    # Edit a seeded row...
    current = client.get("/api/prompts/equity", headers=auth_headers).json()["prompt"]
    client.put(
        "/api/prompts/equity",
        json={
            "name": current["name"], "kind": current["kind"], "assetClass": current["assetClass"],
            "productFamily": current["productFamily"], "scopeDescription": current["scopeDescription"],
            "body": "CORPS REMPLACÉ PAR L'ADMIN",
        },
        headers=auth_headers,
    )
    # ...then re-run the seed against the SAME db and confirm the edit survives.
    import app.db as db_module

    db_module._seed_prompts()
    assert db_module.get_prompt("equity")["body"] == "CORPS REMPLACÉ PAR L'ADMIN"
