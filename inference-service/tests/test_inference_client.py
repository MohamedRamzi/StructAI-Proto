"""Unit tests for services/inference_client.chat_completion's provider dispatch
(openai_compatible vs gemini). httpx.post is monkeypatched — no real sidecar or
Gemini API call is ever made, matching the project-wide "no real inference
engine in automated tests" principle."""
import httpx
import pytest


class FakeResponse:
    def __init__(self, status_code: int, json_body: dict, text: str = ""):
        self.status_code = status_code
        self._json_body = json_body
        self.text = text or str(json_body)

    def json(self):
        return self._json_body


def test_openai_compatible_posts_to_chat_completions_with_no_auth_header_by_default(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="local-model", base_url="http://localhost:8001/v1", api_key=None, updated_by=1)

    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return FakeResponse(200, {"choices": [{"message": {"content": "Bonjour"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)

    result = inference_client.chat_completion("system", "user")
    assert result == "Bonjour"
    assert captured["url"] == "http://localhost:8001/v1/chat/completions"
    assert captured["json"]["model"] == "local-model"
    assert captured["headers"] == {}


def test_openai_compatible_sends_bearer_token_when_api_key_is_set(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="gpt-x", base_url="https://api.example.com/v1", api_key="sk-secret", updated_by=1)

    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        captured["headers"] = headers
        return FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    inference_client.chat_completion("system", "user")
    assert captured["headers"] == {"Authorization": "Bearer sk-secret"}


def test_gemini_requires_an_api_key(client):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-2.5-flash", api_key=None, updated_by=1)

    with pytest.raises(RuntimeError, match="clé API Gemini"):
        inference_client.chat_completion("system", "user")


def test_gemini_calls_the_google_api_with_the_key_as_a_query_param(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-2.5-flash", api_key="my-gemini-key", updated_by=1)

    captured = {}

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        captured["url"] = url
        captured["params"] = params
        captured["json"] = json
        return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": '{"quotes": []}'}]}}]})

    monkeypatch.setattr(httpx, "post", fake_post)

    result = inference_client.chat_completion("system prompt", "user prompt")
    assert result == '{"quotes": []}'
    assert captured["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    assert captured["params"] == {"key": "my-gemini-key"}
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == "system prompt"


def test_gemini_surfaces_a_clear_error_on_non_200_no_silent_fallback(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-2.5-flash", api_key="bad-key", updated_by=1)

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        return FakeResponse(400, {"error": {"message": "API key not valid"}}, text='{"error": {"message": "API key not valid"}}')

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RuntimeError, match="API key not valid"):
        inference_client.chat_completion("system", "user")


def test_openai_compatible_network_error_is_wrapped_no_silent_fallback(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="m", base_url="http://localhost:9999/v1", api_key=None, updated_by=1)

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RuntimeError, match="Impossible de contacter le moteur de chat"):
        inference_client.chat_completion("system", "user")


def test_gemini_retries_once_on_503_then_succeeds(client, monkeypatch):
    """A 503 is documented by Google as "temporarily overloaded, retry" — this
    is the one case where a bounded retry is correct, not a masked failure."""
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="a-key", updated_by=1)
    monkeypatch.setattr(inference_client.time, "sleep", lambda seconds: None)

    calls = {"count": 0}

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        calls["count"] += 1
        if calls["count"] == 1:
            return FakeResponse(503, {"error": {"message": "high demand"}}, text='{"error": {"message": "high demand"}}')
        return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "ok after retry"}]}}]})

    monkeypatch.setattr(httpx, "post", fake_post)

    result = inference_client.chat_completion("system", "user")
    assert result == "ok after retry"
    assert calls["count"] == 2


def test_gemini_gives_up_after_max_retries_on_persistent_503(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="a-key", updated_by=1)
    monkeypatch.setattr(inference_client.time, "sleep", lambda seconds: None)

    calls = {"count": 0}

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        calls["count"] += 1
        return FakeResponse(503, {"error": {"message": "high demand"}}, text='{"error": {"message": "high demand"}}')

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RuntimeError, match="503"):
        inference_client.chat_completion("system", "user")
    # 1 initial attempt + _MAX_RETRIES retries, never more.
    assert calls["count"] == 1 + inference_client._MAX_RETRIES


def test_other_error_statuses_are_never_retried(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="bad-key", updated_by=1)
    monkeypatch.setattr(inference_client.time, "sleep", lambda seconds: None)

    calls = {"count": 0}

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        calls["count"] += 1
        return FakeResponse(400, {"error": {"message": "API key not valid"}}, text='{"error": {"message": "API key not valid"}}')

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(RuntimeError, match="API key not valid"):
        inference_client.chat_completion("system", "user")
    assert calls["count"] == 1


def test_unknown_provider_raises_a_clear_error(client):
    from app import db
    from app.services import inference_client

    # Bypass the router's own validation to exercise inference_client's own guard directly.
    db.db.execute("UPDATE llm_settings SET provider = 'carrier-pigeon' WHERE id = 1")
    db.db.commit()

    with pytest.raises(RuntimeError, match="Provider LLM inconnu"):
        inference_client.chat_completion("system", "user")


# --- reasoning / "thinking" mode ---------------------------------------------

def _capture_openai_post(monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        captured["json"] = json
        return FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    return captured


def _capture_gemini_post(monkeypatch):
    captured = {}

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        captured["json"] = json
        return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    return captured


def test_openai_reasoning_mode_auto_sends_no_chat_template_kwargs(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="qwen3", base_url="http://localhost:8001/v1", api_key=None, updated_by=1, reasoning_mode="auto")
    captured = _capture_openai_post(monkeypatch)
    inference_client.chat_completion("system", "user")
    assert "chat_template_kwargs" not in captured["json"]


def test_openai_reasoning_mode_fast_disables_thinking(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="qwen3", base_url="http://localhost:8001/v1", api_key=None, updated_by=1, reasoning_mode="fast")
    captured = _capture_openai_post(monkeypatch)
    inference_client.chat_completion("system", "user")
    assert captured["json"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_per_request_override_beats_the_stored_default(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="qwen3", base_url="http://localhost:8001/v1", api_key=None, updated_by=1, reasoning_mode="fast")
    captured = _capture_openai_post(monkeypatch)
    inference_client.chat_completion("system", "user", reasoning_mode="thinking")
    assert captured["json"]["chat_template_kwargs"] == {"enable_thinking": True}


def test_gemini_reasoning_mode_maps_to_thinking_budget(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="k", updated_by=1, reasoning_mode="auto")

    captured = _capture_gemini_post(monkeypatch)
    inference_client.chat_completion("system", "user")
    assert "thinkingConfig" not in captured["json"]["generationConfig"]

    captured = _capture_gemini_post(monkeypatch)
    inference_client.chat_completion("system", "user", reasoning_mode="fast")
    assert captured["json"]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}

    captured = _capture_gemini_post(monkeypatch)
    inference_client.chat_completion("system", "user", reasoning_mode="thinking")
    assert captured["json"]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": -1}


def test_gemini_thinking_summary_parts_are_dropped_from_the_answer(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="k", updated_by=1)

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        return FakeResponse(200, {"candidates": [{"content": {"parts": [
            {"text": "let me think...", "thought": True},
            {"text": '{"quotes": []}'},
        ]}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    assert inference_client.chat_completion("system", "user") == '{"quotes": []}'
