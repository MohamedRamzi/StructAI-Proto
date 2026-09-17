"""POST /api/direct-chat — the admin's raw, pipeline-free chat tester. The
model call itself is exercised in depth in test_inference_client.py; here we
cover the router's own contract (validation, auth, error mapping)."""
import json

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


def test_a_simple_exchange_returns_content_and_stats(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(
        inference_client, "chat",
        lambda messages, reasoning_mode=None, json_mode=True: {
            "content": "Bonjour ! Comment puis-je vous aider ?",
            "model": "qwen3-4b-instruct",
            "finishReason": "stop",
            "usage": {"promptTokens": 10, "completionTokens": 8, "totalTokens": 18},
            "durationMs": 340,
        },
    )

    res = client.post(
        "/api/direct-chat",
        json={"messages": [{"role": "user", "content": "Bonjour"}]},
        headers=auth_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["content"] == "Bonjour ! Comment puis-je vous aider ?"
    assert body["usage"]["totalTokens"] == 18
    assert body["durationMs"] == 340


def test_forwards_the_full_message_history_and_reasoning_mode_as_given(client, auth_headers, monkeypatch):
    from app.services import inference_client

    captured = {}

    def fake_chat(messages, reasoning_mode=None, json_mode=True):
        captured["messages"] = messages
        captured["reasoning_mode"] = reasoning_mode
        captured["json_mode"] = json_mode
        return {"content": "ok", "model": "m", "finishReason": "stop", "usage": {}, "durationMs": 1}

    monkeypatch.setattr(inference_client, "chat", fake_chat)

    history = [
        {"role": "user", "content": "Bonjour"},
        {"role": "assistant", "content": "Salut !"},
        {"role": "user", "content": "Ça va ?"},
    ]
    res = client.post(
        "/api/direct-chat",
        json={"messages": history, "reasoningMode": "thinking"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert captured["messages"] == history
    assert captured["reasoning_mode"] == "thinking"
    assert captured["json_mode"] is False  # free-form chat, never forced JSON


def test_rejects_an_empty_message_list(client, auth_headers):
    res = client.post("/api/direct-chat", json={"messages": []}, headers=auth_headers)
    assert res.status_code == 400


def test_rejects_a_blank_message(client, auth_headers):
    res = client.post("/api/direct-chat", json={"messages": [{"role": "user", "content": "   "}]}, headers=auth_headers)
    assert res.status_code == 400


def test_rejects_an_invalid_role(client, auth_headers):
    res = client.post("/api/direct-chat", json={"messages": [{"role": "narrator", "content": "..."}]}, headers=auth_headers)
    assert res.status_code == 400


def test_engine_failure_surfaces_as_502_not_silently_swallowed(client, auth_headers, monkeypatch):
    from app.services import inference_client

    def fake_chat(messages, reasoning_mode=None, json_mode=True):
        raise RuntimeError("Impossible de contacter le moteur de chat configuré sur http://localhost:8001/v1 : timed out.")

    monkeypatch.setattr(inference_client, "chat", fake_chat)

    res = client.post("/api/direct-chat", json={"messages": [{"role": "user", "content": "Salut"}]}, headers=auth_headers)
    assert res.status_code == 502
    assert "Impossible de contacter" in res.json()["error"]


def test_requires_authentication(client):
    res = client.post("/api/direct-chat", json={"messages": [{"role": "user", "content": "Salut"}]})
    assert res.status_code == 401


def test_any_authenticated_user_can_use_it_not_just_admin(client, member_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(
        inference_client, "chat",
        lambda messages, reasoning_mode=None, json_mode=True: {
            "content": "ok", "model": "m", "finishReason": "stop", "usage": {}, "durationMs": 1,
        },
    )
    res = client.post("/api/direct-chat", json={"messages": [{"role": "user", "content": "Salut"}]}, headers=member_headers)
    assert res.status_code == 200
