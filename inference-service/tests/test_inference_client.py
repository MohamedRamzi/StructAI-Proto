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


# --- chat() — the general multi-turn entry point (admin direct-chat tester) --

def test_chat_openai_compatible_forwards_multi_turn_messages_unchanged(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="qwen3", base_url="http://localhost:8001/v1", api_key=None, updated_by=1)
    captured = _capture_openai_post(monkeypatch)

    messages = [
        {"role": "system", "content": "Tu es un assistant."},
        {"role": "user", "content": "Bonjour"},
        {"role": "assistant", "content": "Salut !"},
        {"role": "user", "content": "Ça va ?"},
    ]
    inference_client.chat(messages)
    assert captured["json"]["messages"] == messages


def test_chat_openai_compatible_returns_usage_finish_reason_and_duration(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="qwen3", base_url="http://localhost:8001/v1", api_key=None, updated_by=1)

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        return FakeResponse(200, {
            "model": "qwen3-4b-instruct",
            "choices": [{"message": {"content": "Bonjour !"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16},
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    result = inference_client.chat([{"role": "user", "content": "Salut"}])

    assert result["content"] == "Bonjour !"
    assert result["model"] == "qwen3-4b-instruct"  # echoed by the server, preferred over cfg's
    assert result["finishReason"] == "stop"
    assert result["usage"] == {"promptTokens": 12, "completionTokens": 4, "totalTokens": 16}
    assert isinstance(result["durationMs"], int) and result["durationMs"] >= 0


def test_chat_openai_compatible_missing_usage_reports_none_not_zero(client, monkeypatch):
    """A server that doesn't echo `usage` must show up as "unknown" (None) to
    the admin UI, not a silently wrong 0 — no-silent-fallback applies to
    diagnostic stats too, not just the answer content."""
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="m", base_url="http://localhost:8001/v1", api_key=None, updated_by=1)

    def fake_post(url, json=None, headers=None, timeout=None, params=None):
        return FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    result = inference_client.chat([{"role": "user", "content": "Salut"}])
    assert result["usage"] == {"promptTokens": None, "completionTokens": None, "totalTokens": None}
    assert result["finishReason"] is None
    assert result["model"] == "m"  # falls back to the configured model name


def test_chat_json_mode_false_does_not_affect_openai_compatible_payload(client, monkeypatch):
    """This provider has never set response_format at all — json_mode is a
    no-op for it either way, verified so a future regression here is caught."""
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="openai_compatible", model="m", base_url="http://localhost:8001/v1", api_key=None, updated_by=1)
    captured = _capture_openai_post(monkeypatch)
    inference_client.chat([{"role": "user", "content": "Salut"}], json_mode=False)
    assert "response_format" not in captured["json"]


def test_chat_gemini_splits_system_message_and_maps_assistant_to_model_role(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="k", updated_by=1)
    captured = _capture_gemini_post(monkeypatch)

    messages = [
        {"role": "system", "content": "Tu es un assistant."},
        {"role": "user", "content": "Bonjour"},
        {"role": "assistant", "content": "Salut !"},
        {"role": "user", "content": "Ça va ?"},
    ]
    inference_client.chat(messages)

    assert captured["json"]["system_instruction"]["parts"][0]["text"] == "Tu es un assistant."
    assert captured["json"]["contents"] == [
        {"role": "user", "parts": [{"text": "Bonjour"}]},
        {"role": "model", "parts": [{"text": "Salut !"}]},
        {"role": "user", "parts": [{"text": "Ça va ?"}]},
    ]


def test_chat_gemini_json_mode_false_skips_response_mime_type(client, monkeypatch):
    """Forcing JSON mode on a free-form "Bonjour, comment vas-tu ?" chat would
    be actively wrong, not just unhelpful — the admin's raw chat tester must
    be able to turn it off."""
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="k", updated_by=1)

    captured = _capture_gemini_post(monkeypatch)
    inference_client.chat([{"role": "user", "content": "Bonjour"}], json_mode=True)
    assert captured["json"]["generationConfig"]["responseMimeType"] == "application/json"

    captured = _capture_gemini_post(monkeypatch)
    inference_client.chat([{"role": "user", "content": "Bonjour"}], json_mode=False)
    assert "responseMimeType" not in captured["json"]["generationConfig"]


def test_chat_gemini_returns_usage_and_finish_reason(client, monkeypatch):
    from app import db
    from app.services import inference_client

    db.update_llm_settings(provider="gemini", model="gemini-flash-latest", api_key="k", updated_by=1)

    def fake_post(url, params=None, json=None, timeout=None, headers=None):
        return FakeResponse(200, {
            "candidates": [{"content": {"parts": [{"text": "Bonjour !"}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 3, "totalTokenCount": 11},
        })

    monkeypatch.setattr(httpx, "post", fake_post)
    result = inference_client.chat([{"role": "user", "content": "Salut"}])
    assert result["finishReason"] == "STOP"
    assert result["usage"] == {"promptTokens": 8, "completionTokens": 3, "totalTokens": 11}
