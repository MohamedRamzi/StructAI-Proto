"""
The chat/analysis path supports two kinds of provider (see db.py's
llm_settings, configurable from the admin UI):

- "openai_compatible": any endpoint speaking the OpenAI chat-completions
  protocol — by default the local vLLM sidecar (`vllm serve`, run as an
  independent HTTP process, never imported in-process — see the architecture
  decision recorded in the project plan: running vLLM in-process was
  empirically observed to segfault on engine shutdown), but also LM Studio,
  Ollama's own OpenAI-compat endpoint, or a real cloud OpenAI-compatible API
  given an API key.
- "gemini": Google's own protocol (generativelanguage.googleapis.com), called
  directly over REST via httpx — no google-genai/google-generativeai SDK
  dependency, for the same reason vLLM itself isn't a dependency here: this
  service only ever needs to speak plain HTTP to whatever is doing the actual
  inference.

Embeddings always go through the vLLM sidecar (POST {embedding baseUrl}/embeddings)
— no cloud embedding provider is wired up.

Deliberately does NOT catch or fall back on failure — any error (sidecar/API
unreachable, missing API key, non-200 response, unexpected payload shape)
propagates as a RuntimeError with a clear, specific message to the caller.
There is no silent degraded mode: an inference failure must be visible, never
masked behind a best-effort guess (same principle already applied throughout
this project). A bounded retry-with-backoff on HTTP 503 is the one exception
(see _post_with_retry) — Google's own Gemini docs explicitly document 503 as
"model temporarily overloaded, please retry", and a local vLLM sidecar can
briefly 503 right as it finishes starting up; both are transient-by-design,
not a failure to mask.
"""
import time
from typing import Optional

import httpx

from .. import db

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

_RETRYABLE_STATUS_CODES = {503}
_MAX_RETRIES = 2
_RETRY_BACKOFF_SECONDS = 1.5


def _post_with_retry(url: str, **kwargs) -> httpx.Response:
    """POSTs with a short retry-with-backoff on HTTP 503 only. Any other
    status, or a connection-level error (httpx.RequestError, handled by the
    caller), is NOT retried and propagates immediately — those mean something
    needs the user's attention (bad config, service actually down), not
    "wait a moment and it'll clear up"."""
    attempt = 0
    while True:
        response = httpx.post(url, **kwargs)
        if response.status_code not in _RETRYABLE_STATUS_CODES or attempt >= _MAX_RETRIES:
            return response
        attempt += 1
        time.sleep(_RETRY_BACKOFF_SECONDS * attempt)


VALID_REASONING_MODES = {"auto", "fast", "thinking"}


def _resolve_reasoning_mode(cfg: dict, override: Optional[str]) -> str:
    """Per-request override wins over the stored default; anything unrecognised
    (or None) falls back to the stored default, itself defaulting to "auto"."""
    if override in VALID_REASONING_MODES:
        return override
    stored = cfg.get("reasoningMode")
    return stored if stored in VALID_REASONING_MODES else "auto"


def chat_completion(system_prompt: str, user_prompt: str, reasoning_mode: Optional[str] = None) -> str:
    """Content-only convenience wrapper around chat() for the routed-analyze
    pipeline's two calls (router classification, domain extraction) — both
    always want JSON back, so json_mode stays at its default (True)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    return chat(messages, reasoning_mode=reasoning_mode)["content"]


def chat(messages: list[dict], reasoning_mode: Optional[str] = None, json_mode: bool = True) -> dict:
    """General entry point: an arbitrary multi-turn message list (roles
    "system"/"user"/"assistant"), not just one fixed system+user pair — used
    directly by the admin's raw chat tester (POST /api/direct-chat), which
    needs real conversation history and free-form text (json_mode=False).

    Returns {content, model, finishReason, usage: {promptTokens,
    completionTokens, totalTokens}, durationMs} — `usage`/`finishReason`
    fields are None where a provider doesn't report them. `durationMs` times
    only the HTTP call itself, not JSON (de)serialization overhead."""
    cfg = db.get_llm_settings()
    provider = cfg.get("provider") or "openai_compatible"
    mode = _resolve_reasoning_mode(cfg, reasoning_mode)
    if provider == "gemini":
        return _gemini_chat(messages, cfg, mode, json_mode)
    if provider == "openai_compatible":
        return _openai_compatible_chat(messages, cfg, mode, json_mode)
    raise RuntimeError(f'Provider LLM inconnu ou non configuré : "{provider}". Configurez un moteur depuis la page d\'admin.')


def _openai_compatible_chat(messages: list[dict], cfg: dict, reasoning_mode: str = "auto", json_mode: bool = True) -> dict:
    """Calls POST {baseUrl}/chat/completions (OpenAI-compatible). `apiKey`, if
    set, is sent as a Bearer token — required for a real cloud OpenAI-compatible
    API, optional (and normally unset) for a local sidecar. `messages` is
    forwarded as-is: OpenAI's chat format already uses "system"/"user"/"assistant"
    roles natively, so no conversion is needed here (unlike Gemini, see below).

    `reasoning_mode` "fast"/"thinking" is passed via vLLM's `chat_template_kwargs`
    (`enable_thinking`), which Qwen3 & other reasoning models' chat templates
    honour; "auto" sends nothing. A non-vLLM endpoint (real OpenAI, LM Studio)
    may reject `chat_template_kwargs` — keep the mode on "auto" there.
    `json_mode` is unused here on purpose: this path has never set a strict
    `response_format`, relying on prompt instructions instead (see the
    "Réponds uniquement avec l'objet JSON..." lines callers already send),
    which also lets free-form chat (json_mode=False) just work with zero
    extra plumbing."""
    base_url = (cfg.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise RuntimeError("Aucune URL de base configurée pour le moteur de chat. Configurez-la depuis la page d'admin.")
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['apiKey']}"} if cfg.get("apiKey") else {}

    payload = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": cfg["temperature"],
    }
    if reasoning_mode == "fast":
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    elif reasoning_mode == "thinking":
        payload["chat_template_kwargs"] = {"enable_thinking": True}

    started = time.monotonic()
    try:
        # 300s, not 120s: a local vLLM-metal sidecar on Apple Silicon (dev) can
        # run an order of magnitude slower than the GH200 target (single-digit
        # tokens/s generation observed), and the extraction call's response is
        # long (full JSON schema, plus reasoning tokens whenever the model's
        # default chat template enables thinking under reasoning_mode="auto").
        # This bounds how long we wait before giving up — it doesn't paper
        # over an actually-down sidecar, which fails immediately on connect.
        response = _post_with_retry(url, json=payload, headers=headers, timeout=300.0)
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Impossible de contacter le moteur de chat configuré sur {base_url} : {exc}. "
            f'Vérifiez que le sidecar "vllm serve" (ou l\'endpoint configuré) tourne et que l\'URL est correcte.'
        ) from exc
    duration_ms = round((time.monotonic() - started) * 1000)

    if response.status_code != 200:
        raise RuntimeError(f"Le moteur de chat ne répond pas ({response.status_code}) sur {url} : {response.text[:300]}")

    data = response.json()
    try:
        choice = data["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Réponse du moteur de chat dans un format inattendu : {data}") from exc

    usage = data.get("usage") or {}
    return {
        "content": content or "",
        "model": data.get("model") or cfg.get("model"),
        "finishReason": choice.get("finish_reason"),
        "usage": {
            "promptTokens": usage.get("prompt_tokens"),
            "completionTokens": usage.get("completion_tokens"),
            "totalTokens": usage.get("total_tokens"),
        },
        "durationMs": duration_ms,
    }


def _gemini_chat(messages: list[dict], cfg: dict, reasoning_mode: str = "auto", json_mode: bool = True) -> dict:
    """Calls Google's Generative Language API directly (no SDK dependency).
    Gemini's protocol splits a "system" message into its own top-level
    `system_instruction` field (at most one, conventionally first) and uses
    role "model" (not "assistant") for the model's own turns in `contents` —
    both handled by the conversion below, so callers only ever deal in the
    OpenAI-style "system"/"user"/"assistant" roles.

    `reasoning_mode` maps to `thinkingConfig.thinkingBudget` (0 = off for
    "fast", -1 = dynamic for "thinking"); "auto" sends nothing. Only the 2.5+
    thinking models honour it — an older model may 400, so keep "auto" there.
    `json_mode=False` (the admin's free-form chat tester) skips
    `responseMimeType: "application/json"` — forcing JSON mode on a plain
    "Bonjour, comment vas-tu ?" would be actively wrong, not just unhelpful."""
    api_key = cfg.get("apiKey")
    if not api_key:
        raise RuntimeError("Aucune clé API Gemini configurée. Renseignez-la depuis la page d'admin (\"Config. Chat\").")

    # "gemini-flash-latest" is Google's own always-current alias — used as the
    # fallback so this doesn't need bumping by hand every time Google ships a
    # new flash model (its dated model ids, e.g. gemini-2.5-flash, do get
    # retired for new API keys — confirmed empirically via a 404 telling
    # callers to switch to the current one).
    model = cfg.get("model") or "gemini-flash-latest"
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent"

    system_instruction = None
    contents = []
    for m in messages:
        if m["role"] == "system":
            if system_instruction is None:  # only the first — Gemini takes one
                system_instruction = {"parts": [{"text": m["content"]}]}
            continue
        contents.append({"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]})

    generation_config = {"temperature": cfg["temperature"]}
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
    if reasoning_mode == "fast":
        generation_config["thinkingConfig"] = {"thinkingBudget": 0}
    elif reasoning_mode == "thinking":
        generation_config["thinkingConfig"] = {"thinkingBudget": -1}

    body = {"contents": contents, "generationConfig": generation_config}
    if system_instruction:
        body["system_instruction"] = system_instruction

    started = time.monotonic()
    try:
        response = _post_with_retry(url, params={"key": api_key}, json=body, timeout=120.0)
    except httpx.RequestError as exc:
        raise RuntimeError(f"Impossible de contacter l'API Gemini : {exc}.") from exc
    duration_ms = round((time.monotonic() - started) * 1000)

    if response.status_code != 200:
        # Gemini's error body is JSON with useful detail (invalid key, quota, ...) —
        # surfaced verbatim (truncated) rather than just the HTTP status, since a
        # bad API key is by far the most common failure here.
        raise RuntimeError(f"L'API Gemini ne répond pas ({response.status_code}) : {response.text[:300]}")

    data = response.json()
    try:
        candidate = data["candidates"][0]
        parts = candidate["content"]["parts"]
        # In "thinking" mode a reasoning summary can come back as parts flagged
        # `thought: true` — keep only the actual answer text.
        content = "".join(part.get("text", "") for part in parts if not part.get("thought"))
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Réponse Gemini dans un format inattendu : {data}") from exc

    usage_meta = data.get("usageMetadata") or {}
    return {
        "content": content or "",
        "model": model,
        "finishReason": candidate.get("finishReason"),
        "usage": {
            "promptTokens": usage_meta.get("promptTokenCount"),
            "completionTokens": usage_meta.get("candidatesTokenCount"),
            "totalTokens": usage_meta.get("totalTokenCount"),
        },
        "durationMs": duration_ms,
    }


def embed(texts: list[str]) -> list[list[float]]:
    """Calls the embedding sidecar's POST /embeddings (OpenAI-compatible)."""
    if not texts:
        return []
    cfg = db.get_embedding_settings()
    base_url = cfg["baseUrl"].rstrip("/")
    url = f"{base_url}/embeddings"
    try:
        response = _post_with_retry(url, json={"model": cfg["model"], "input": texts}, timeout=60.0)
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Impossible de contacter le moteur d'embedding (vLLM) sur {base_url} : {exc}. "
            f'Vérifiez que le sidecar "vllm serve --runner pooling" tourne et que l\'URL est correcte.'
        ) from exc

    if response.status_code != 200:
        raise RuntimeError(f"Le moteur d'embedding (vLLM) ne répond pas ({response.status_code}) sur {url} : {response.text[:300]}")

    data = response.json()
    items = data.get("data")
    if not items or len(items) != len(texts):
        raise RuntimeError(f'Le moteur d\'embedding (vLLM) a répondu sans embeddings exploitables pour le modèle "{cfg["model"]}".')

    # The OpenAI-compatible /embeddings response isn't guaranteed to preserve
    # input order; each item carries its own "index" to restore it.
    ordered = sorted(items, key=lambda item: item.get("index", 0))
    return [item["embedding"] for item in ordered]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


# Qwen3-Embedding (and most modern instruct-tuned embedders) are ASYMMETRIC:
# the document side is embedded raw, but the QUERY side must be wrapped in an
# instruction ("Instruct: <task>\nQuery: <text>"). Skipping this is a large,
# silent retrieval-quality hit — a query for "EuroStoxx" lands in a slightly
# different subspace than the "EURO STOXX 50" document and gets out-ranked by
# unrelated instruments. The wrapper is applied only for Qwen3-Embedding models
# (other embedders may not expect it).
_EMBED_QUERY_INSTRUCTION = (
    "Retrouve l'instrument financier (indice, action, taux d'intérêt, paire de change, "
    "indice de crédit) qui correspond le mieux à la description ou au nom recherché."
)


def _wants_query_instruction(model: str) -> bool:
    return "qwen3-embedding" in (model or "").lower()


def embed_query(text: str) -> list[float]:
    """Embed a SEARCH QUERY (as opposed to a stored document — use embed_one for those)."""
    model = db.get_embedding_settings()["model"]
    payload = f"Instruct: {_EMBED_QUERY_INSTRUCTION}\nQuery: {text}" if _wants_query_instruction(model) else text
    return embed([payload])[0]
