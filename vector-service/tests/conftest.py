"""
Test fixtures. Two things need isolating per test: (1) the SQLite/Chroma
stores, which are module-level singletons initialized from env vars at
import time (mirrors quotation-service/src/db.ts's pattern) — so each test
gets fresh env vars pointed at a tmp_path, then force-reimports every `app.*`
module; (2) the embedding call, monkeypatched to a deterministic bag-of-words
hashing function so tests never need a real Ollama running, yet still
produce meaningfully different vectors for different text (real ranking
behavior to assert on, not just "does it not crash").
"""
import hashlib
import re
import sys

import pytest
from fastapi.testclient import TestClient

VOCAB_SIZE = 64


def fake_embed_text(text: str) -> list[float]:
    vector = [0.0] * VOCAB_SIZE
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % VOCAB_SIZE
        vector[idx] += 1.0
    norm = sum(v * v for v in vector) ** 0.5
    return [v / norm for v in vector] if norm > 0 else vector


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "chroma"))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("ADMIN_EMAIL", "admin@test.local")
    monkeypatch.setenv("ADMIN_PASSWORD", "admin-test-password")

    for mod_name in list(sys.modules):
        if mod_name == "app" or mod_name.startswith("app."):
            del sys.modules[mod_name]

    import app.main as main_module
    from app.services import embeddings as embeddings_module

    monkeypatch.setattr(embeddings_module, "get_embedding", lambda text, model, base_url: fake_embed_text(text))
    monkeypatch.setattr(embeddings_module, "get_embeddings", lambda texts, model, base_url: [fake_embed_text(t) for t in texts])

    return TestClient(main_module.app)


@pytest.fixture()
def admin_token(client):
    res = client.post("/api/auth/login", json={"email": "admin@test.local", "password": "admin-test-password"})
    return res.json()["token"]


@pytest.fixture()
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
