"""
SQLite storage — the single system of record for this merged service: users,
service API keys, the two vLLM sidecar configs (llm_settings for chat/analysis,
embedding_settings for embeddings), and instruments (the RAG data, admin
CRUD/import/export). Chroma (see services/vector_store.py) holds only the
semantic index derived from `instruments`; every write there is paired with a
Chroma upsert/delete in services/instruments.py so the two never drift apart.

Uses Python's stdlib sqlite3 (no native-module install risk), matching the
choice already made for vector-service and (via node:sqlite) quotation-service.
"""
import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import config
from .auth.hashing import hash_password, verify_password

Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(config.DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys = ON")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_schema() -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS llm_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT NOT NULL DEFAULT 'openai_compatible',
            model TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            api_key TEXT,
            temperature REAL NOT NULL DEFAULT 0.1,
            updated_at TEXT NOT NULL,
            updated_by INTEGER REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS embedding_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            model TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            updated_by INTEGER REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            created_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL,
            revoked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS instruments (
            id TEXT PRIMARY KEY,
            asset_class TEXT NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_instruments_asset_class ON instruments(asset_class);
        """
    )
    db.commit()
    _migrate_llm_settings()
    _bootstrap()


def _migrate_llm_settings() -> None:
    """CREATE TABLE IF NOT EXISTS never adds columns to an already-existing table —
    a db created before `provider`/`api_key` existed on llm_settings (restoring
    multi-provider support: a local OpenAI-compatible sidecar OR a cloud provider
    like Gemini, given an API key) needs them added explicitly, once, in place."""
    existing_cols = {row["name"] for row in db.execute("PRAGMA table_info(llm_settings)").fetchall()}
    if "provider" not in existing_cols:
        db.execute("ALTER TABLE llm_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai_compatible'")
    if "api_key" not in existing_cols:
        db.execute("ALTER TABLE llm_settings ADD COLUMN api_key TEXT")
    db.commit()


def _bootstrap() -> None:
    user_count = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    if user_count == 0:
        password = config.ADMIN_PASSWORD or secrets.token_urlsafe(9)
        db.execute(
            "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
            (config.ADMIN_EMAIL, hash_password(password), _now()),
        )
        db.commit()
        note = "" if config.ADMIN_PASSWORD else f" (mot de passe généré : {password} — changez-le après connexion)"
        print(f"[inference-service] Compte admin initial créé : {config.ADMIN_EMAIL}{note}")

    if db.execute("SELECT id FROM llm_settings WHERE id = 1").fetchone() is None:
        # GEMINI_API_KEY is only used as an initial convenience if the bootstrap
        # provider is actually "gemini" — same principle as everywhere else: no
        # implicit cross-provider fallback, an admin can always set/change this
        # from the UI afterwards.
        initial_api_key = config.GEMINI_API_KEY if config.LLM_PROVIDER == "gemini" else None
        db.execute(
            "INSERT INTO llm_settings (id, provider, model, base_url, api_key, temperature, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)",
            (config.LLM_PROVIDER, config.LLM_MODEL, config.LLM_BASE_URL, initial_api_key, config.LLM_TEMPERATURE, _now()),
        )
        db.commit()

    if db.execute("SELECT id FROM embedding_settings WHERE id = 1").fetchone() is None:
        db.execute(
            "INSERT INTO embedding_settings (id, model, base_url, updated_at) VALUES (1, ?, ?, ?)",
            (config.EMBEDDING_MODEL, config.EMBEDDING_BASE_URL, _now()),
        )
        db.commit()


# --- Users ---

def list_users() -> list[dict]:
    rows = db.execute("SELECT id, email, role, created_at FROM users ORDER BY id ASC").fetchall()
    return [{"id": r["id"], "email": r["email"], "role": r["role"], "createdAt": r["created_at"]} for r in rows]


def find_user_by_email(email: str) -> Optional[sqlite3.Row]:
    return db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def find_user_by_id(user_id: int) -> Optional[sqlite3.Row]:
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create_user(email: str, password: str, role: str) -> sqlite3.Row:
    db.execute(
        "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        (email, hash_password(password), role, _now()),
    )
    db.commit()
    return find_user_by_email(email)


def update_user(user_id: int, role: Optional[str] = None, password: Optional[str] = None) -> Optional[sqlite3.Row]:
    if role is not None:
        db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    if password is not None:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user_id))
    db.commit()
    return find_user_by_id(user_id)


def delete_user(user_id: int) -> None:
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()


def count_admins() -> int:
    return db.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").fetchone()["c"]


def verify_user_credentials(email: str, password: str) -> Optional[sqlite3.Row]:
    user = find_user_by_email(email)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    return user


# --- LLM (chat/analysis) provider config ---
# `provider` is either "openai_compatible" (any endpoint speaking the OpenAI
# chat-completions protocol — the local vLLM sidecar, LM Studio, Ollama's own
# OpenAI-compat endpoint, or a real cloud OpenAI-compatible API, with `apiKey`
# as an optional Bearer token) or "gemini" (Google's own protocol, `apiKey`
# required). `get_llm_settings()` returns the real apiKey — it's for internal
# use by inference_client.py only; routers/llm_config.py must redact it to
# `hasApiKey` before this ever reaches an HTTP response.

_KEEP_API_KEY = "\x00KEEP\x00"  # sentinel default for update_llm_settings's api_key param — see below.


def get_llm_settings() -> dict:
    row = db.execute("SELECT * FROM llm_settings WHERE id = 1").fetchone()
    return {
        "provider": row["provider"],
        "model": row["model"],
        "baseUrl": row["base_url"],
        "apiKey": row["api_key"],
        "temperature": row["temperature"],
        "updatedAt": row["updated_at"],
    }


def update_llm_settings(
    provider: Optional[str] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: Optional[float] = None,
    updated_by: Optional[int] = None,
    api_key: Optional[str] = _KEEP_API_KEY,
) -> dict:
    """`api_key` has three distinct states, matching the API layer's contract
    (see routers/llm_config.py): omitted (default sentinel) -> leave the stored
    key untouched; None -> explicitly clear it; any string -> set it."""
    current = get_llm_settings()
    new_api_key = current["apiKey"] if api_key is _KEEP_API_KEY else api_key
    db.execute(
        "UPDATE llm_settings SET provider = ?, model = ?, base_url = ?, api_key = ?, temperature = ?, updated_at = ?, updated_by = ? WHERE id = 1",
        (
            provider if provider is not None else current["provider"],
            model if model is not None else current["model"],
            base_url if base_url is not None else current["baseUrl"],
            new_api_key,
            temperature if temperature is not None else current["temperature"],
            _now(),
            updated_by,
        ),
    )
    db.commit()
    return get_llm_settings()


# --- Embedding sidecar config ---

def get_embedding_settings() -> dict:
    row = db.execute("SELECT * FROM embedding_settings WHERE id = 1").fetchone()
    return {"model": row["model"], "baseUrl": row["base_url"], "updatedAt": row["updated_at"]}


def update_embedding_settings(model: Optional[str], base_url: Optional[str], updated_by: int) -> dict:
    current = get_embedding_settings()
    db.execute(
        "UPDATE embedding_settings SET model = ?, base_url = ?, updated_at = ?, updated_by = ? WHERE id = 1",
        (model if model is not None else current["model"], base_url if base_url is not None else current["baseUrl"], _now(), updated_by),
    )
    db.commit()
    return get_embedding_settings()


# --- API keys ---
# Token format "isk_<row id>_<random secret>": the id gives O(1) lookup, the
# secret is bcrypt-hashed and only ever shown once, at creation time.

def list_api_keys() -> list[dict]:
    rows = db.execute("SELECT id, label, key_prefix, created_by, created_at, revoked_at FROM api_keys ORDER BY id DESC").fetchall()
    return [
        {"id": r["id"], "label": r["label"], "keyPrefix": r["key_prefix"], "createdBy": r["created_by"], "createdAt": r["created_at"], "revokedAt": r["revoked_at"]}
        for r in rows
    ]


def create_api_key(label: str, created_by: int) -> tuple[dict, str]:
    secret = secrets.token_urlsafe(24)
    key_hash = hash_password(secret)
    key_prefix = secret[:8]
    created_at = _now()
    cur = db.execute(
        "INSERT INTO api_keys (label, key_hash, key_prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        (label, key_hash, key_prefix, created_by, created_at),
    )
    db.commit()
    key_id = cur.lastrowid
    plain_token = f"isk_{key_id}_{secret}"
    return {"id": key_id, "label": label, "keyPrefix": key_prefix, "createdBy": created_by, "createdAt": created_at, "revokedAt": None}, plain_token


def revoke_api_key(key_id: int) -> None:
    db.execute("UPDATE api_keys SET revoked_at = ? WHERE id = ?", (_now(), key_id))
    db.commit()


def verify_api_key_token(token: str) -> Optional[int]:
    if not token.startswith("isk_"):
        return None
    parts = token.split("_", 2)
    if len(parts) != 3:
        return None
    _, key_id_str, secret = parts
    if not key_id_str.isdigit():
        return None
    row = db.execute("SELECT * FROM api_keys WHERE id = ?", (int(key_id_str),)).fetchone()
    if not row or row["revoked_at"]:
        return None
    return row["id"] if verify_password(secret, row["key_hash"]) else None


# --- Instruments ---

def _row_to_instrument(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "assetClass": row["asset_class"],
        "code": row["code"],
        "name": row["name"],
        "description": row["description"],
        "tags": json.loads(row["tags"]),
        "metadata": json.loads(row["metadata"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def make_instrument_id(asset_class: str, code: str) -> str:
    return f"{asset_class}:{code}"


def list_instruments(asset_class: Optional[str] = None, search: Optional[str] = None, limit: int = 100, offset: int = 0) -> list[dict]:
    query = "SELECT * FROM instruments WHERE 1=1"
    params: list[Any] = []
    if asset_class:
        query += " AND asset_class = ?"
        params.append(asset_class)
    if search:
        query += " AND (code LIKE ? OR name LIKE ? OR description LIKE ?)"
        like = f"%{search}%"
        params.extend([like, like, like])
    query += " ORDER BY asset_class ASC, code ASC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = db.execute(query, params).fetchall()
    return [_row_to_instrument(r) for r in rows]


def get_instrument(instrument_id: str) -> Optional[dict]:
    row = db.execute("SELECT * FROM instruments WHERE id = ?", (instrument_id,)).fetchone()
    return _row_to_instrument(row) if row else None


def upsert_instrument(asset_class: str, code: str, name: str, description: str, tags: list[str], metadata: dict) -> dict:
    instrument_id = make_instrument_id(asset_class, code)
    existing = db.execute("SELECT created_at FROM instruments WHERE id = ?", (instrument_id,)).fetchone()
    now = _now()
    created_at = existing["created_at"] if existing else now
    db.execute(
        """
        INSERT INTO instruments (id, asset_class, code, name, description, tags, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            tags = excluded.tags,
            metadata = excluded.metadata,
            updated_at = excluded.updated_at
        """,
        (instrument_id, asset_class, code, name, description, json.dumps(tags), json.dumps(metadata), created_at, now),
    )
    db.commit()
    return get_instrument(instrument_id)


def delete_instrument(instrument_id: str) -> None:
    db.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))
    db.commit()


init_schema()
