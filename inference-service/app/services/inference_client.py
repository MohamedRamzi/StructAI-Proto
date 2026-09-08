"""
The ONLY place this service talks to vLLM — and it does so purely over HTTP,
never by importing `vllm` in-process. Two independent `vllm serve` sidecars
are called through their OpenAI-compatible API: one for chat/analysis
(POST {LLM baseUrl}/chat/completions), one for embeddings
(POST {embedding baseUrl}/embeddings). See the architecture decision recorded
in the project plan: running vLLM in-process was empirically observed to
segfault on engine shutdown; a sidecar process crashing never takes this API
down with it, and `vllm serve` is the official, tooled way to run vLLM anyway.

Deliberately does NOT catch or fall back on failure — any error (sidecar
unreachable, non-200 response, unexpected payload shape) propagates as a
RuntimeError with a clear, specific message to the caller. There is no silent
degraded mode: an inference failure must be visible, never masked behind a
best-effort guess (same principle already applied throughout this project).
"""
import httpx

from .. import db


def chat_completion(system_prompt: str, user_prompt: str) -> str:
    """Calls the chat sidecar's POST /chat/completions (OpenAI-compatible) and
    returns the assistant message's raw text content."""
    cfg = db.get_llm_settings()
    base_url = cfg["baseUrl"].rstrip("/")
    url = f"{base_url}/chat/completions"
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
            timeout=120.0,
        )
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Impossible de contacter le moteur de chat (vLLM) sur {base_url} : {exc}. "
            f'Vérifiez que le sidecar "vllm serve" tourne et que l\'URL est correcte.'
        ) from exc

    if response.status_code != 200:
        raise RuntimeError(f"Le moteur de chat (vLLM) ne répond pas ({response.status_code}) sur {url} : {response.text[:300]}")

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Réponse du moteur de chat (vLLM) dans un format inattendu : {data}") from exc
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
