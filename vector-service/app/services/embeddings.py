"""
Embedding client for Qwen3-Embedding served locally via Ollama
(`ollama pull qwen3-embedding`). Deliberately a thin, mockable wrapper around
a plain HTTP call (not chromadb's built-in embedding-function classes) so
tests can substitute a deterministic fake without needing Ollama running —
same "no silent fallback, clear error on failure" philosophy as
quotation-service's llm-client.ts.
"""
import httpx


def get_embeddings(texts: list[str], model: str, base_url: str) -> list[list[float]]:
    """Calls Ollama's batch embeddings endpoint (POST /api/embed)."""
    if not texts:
        return []
    url = f"{base_url.rstrip('/')}/api/embed"
    try:
        response = httpx.post(url, json={"model": model, "input": texts}, timeout=60.0)
    except httpx.RequestError as exc:
        raise RuntimeError(
            f"Impossible de contacter Ollama sur {base_url} : {exc}. "
            f"Vérifiez qu'Ollama tourne et que le modèle \"{model}\" est installé (ollama pull {model})."
        ) from exc

    if response.status_code != 200:
        raise RuntimeError(f"Ollama ne répond pas ({response.status_code}) sur {url} : {response.text[:300]}")

    data = response.json()
    embeddings = data.get("embeddings")
    if not embeddings or len(embeddings) != len(texts):
        raise RuntimeError(f'Ollama a répondu sans embeddings exploitables pour le modèle "{model}".')
    return embeddings


def get_embedding(text: str, model: str, base_url: str) -> list[float]:
    return get_embeddings([text], model, base_url)[0]
