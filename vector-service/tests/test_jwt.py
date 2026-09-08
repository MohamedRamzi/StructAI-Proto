import sys

import pytest


def _fresh_jwt_module(monkeypatch, secret: str):
    monkeypatch.setenv("JWT_SECRET", secret)
    for mod_name in list(sys.modules):
        if mod_name == "app" or mod_name.startswith("app."):
            del sys.modules[mod_name]
    import app.auth.jwt as jwt_module
    return jwt_module


def test_round_trips_a_payload(monkeypatch):
    jwt_module = _fresh_jwt_module(monkeypatch, "test-secret-not-for-production")
    token = jwt_module.sign_auth_token(1, "admin@structai.local", "admin")
    payload = jwt_module.verify_auth_token(token)
    assert payload["userId"] == 1
    assert payload["email"] == "admin@structai.local"
    assert payload["role"] == "admin"


def test_returns_none_for_garbage_token(monkeypatch):
    jwt_module = _fresh_jwt_module(monkeypatch, "test-secret-not-for-production")
    assert jwt_module.verify_auth_token("not-a-real-jwt") is None


def test_returns_none_for_token_signed_with_different_secret(monkeypatch):
    jwt_module = _fresh_jwt_module(monkeypatch, "secret-a")
    token = jwt_module.sign_auth_token(2, "user@structai.local", "user")

    jwt_module_b = _fresh_jwt_module(monkeypatch, "secret-b")
    assert jwt_module_b.verify_auth_token(token) is None


def test_raises_when_jwt_secret_not_configured(monkeypatch):
    jwt_module = _fresh_jwt_module(monkeypatch, "")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        jwt_module.sign_auth_token(1, "a@b.com", "user")
