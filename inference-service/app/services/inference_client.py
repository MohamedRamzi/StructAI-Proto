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
this project).
"""
import httpx

from .. import db

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"


def chat_completion(system_prompt: str, user_prompt: str) -> str:
    cfg = db.get_llm_settings()
    provider = cfg.get("provider") or "openai_compatible"
    if provider == "gemini":
        return _gemini_chat_completion(system_prompt, user_prompt, cfg)
    if provider == "openai_compatible":
        return _openai_compatible_chat_completion(system_prompt, user_prompt, cfg)
    raise RuntimeError(f'Provider LLM inconnu ou non configuré : "{provider}". Configurez un moteur depuis la page d\'admin.')


def _openai_compatible_chat_completion(system_prompt: str, user_prompt: str, cfg: dict) -> str:
    """Calls POST {baseUrl}/chat/completions (OpenAI-compatible) and returns the
    assistant message's raw text content. `apiKey`, if set, is sent as a Bearer
    token — required for a real cloud OpenAI-compatible API, optional (and
    normally unset) for a local sidecar."""
    base_url = (cfg.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise RuntimeError("Aucune URL de base configurée pour le moteur de chat. Configurez-la depuis la page d'admin.")
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['apiKey']}"} if cfg.get("apiKey") else {}

    try:
        response = httpx.post(
            url,
            json={
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": cfg["temperature"],
            },
            headers=headers,
            timeout=120.0,
        )
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Impossible de contacter le moteur de chat configuré sur {base_url} : {exc}. "
            f'Vérifiez que le sidecar "vllm serve" (ou l\'endpoint configuré) tourne et que l\'URL est correcte.'
        ) from exc

    if response.status_code != 200:
        raise RuntimeError(f"Le moteur de chat ne répond pas ({response.status_code}) sur {url} : {response.text[:300]}")

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Réponse du moteur de chat dans un format inattendu : {data}") from exc
    return content or ""


def _gemini_chat_completion(system_prompt: str, user_prompt: str, cfg: dict) -> str:
    """Calls Google's Generative Language API directly (no SDK dependency)."""
    api_key = cfg.get("apiKey")
    if not api_key:
        raise RuntimeError("Aucune clé API Gemini configurée. Renseignez-la depuis la page d'admin (\"Config. Chat\").")

    model = cfg.get("model") or "gemini-2.5-flash"
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent"

    try:
        response = httpx.post(
            url,
            params={"key": api_key},
            json={
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "generationConfig": {
                    "temperature": cfg["temperature"],
                    "responseMimeType": "application/json",
                },
            },
            timeout=120.0,
        )
    except httpx.RequestError as exc:
        raise RuntimeError(f"Impossible de contacter l'API Gemini : {exc}.") from exc

    if response.status_code != 200:
        # Gemini's error body is JSON with useful detail (invalid key, quota, ...) —
        # surfaced verbatim (truncated) rather than just the HTTP status, since a
        # bad API key is by far the most common failure here.
        raise RuntimeError(f"L'API Gemini ne répond pas ({response.status_code}) : {response.text[:300]}")

    data = response.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        content = "".join(part.get("text", "") for part in parts)
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Réponse Gemini dans un format inattendu : {data}") from exc
    return content or ""


def embed(texts: list[str]) -> list[list[float]]:
    """Calls the embedding sidecar's POST /embeddings (OpenAI-compatible)."""
    if not texts:
        return []
    cfg = db.get_embedding_settings()
    base_url = cfg["baseUrl"].rstrip("/")
    url = f"{base_url}/embeddings"
    try:
        response = httpx.post(url, json={"model": cfg["model"], "input": texts}, timeout=60.0)
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
