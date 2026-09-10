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

        CREATE TABLE IF NOT EXISTS prompts (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'domain',
            asset_class TEXT,
            product_family TEXT,
            scope_description TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            is_protected INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            updated_by INTEGER REFERENCES users(id)
        );
        """
    )
    db.commit()
    _migrate_llm_settings()
    _bootstrap()
    _seed_prompts()


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


# --- Prompts (routed analyze pipeline) ---
# The router prompt, the shared "_common" rules, and the per-scope domain
# prompts all live here. Seeded once from inference-service/prompts/*.md
# (frontmatter + body); the seed is IDEMPOTENT — it inserts a `key` that is
# missing but never overwrites a row an admin has since edited.

_PROTECTED_PROMPT_KEYS = {"router", "_common", "default"}


def _parse_prompt_file(text: str) -> tuple[dict, str]:
    """Splits a seed file into (frontmatter dict, body). Frontmatter is a flat
    block of `key: value` lines between two `---` fences; an empty value means
    the field is absent (stored as NULL)."""
    if not text.startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    meta: dict = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            raw_key, raw_val = line.split(":", 1)
            val = raw_val.strip().strip('"').strip("'")
            meta[raw_key.strip()] = val or None
    return meta, parts[2].strip()


def _iter_prompt_seed_files():
    """Yields (key, meta, body) for every seed file directly under PROMPTS_DIR
    (not recursive — prompts/reference/ holds the long-form docs and is skipped)."""
    prompts_dir = config.PROMPTS_DIR
    if not prompts_dir.is_dir():
        return
    for md_path in sorted(prompts_dir.glob("*.md")):
        meta, body = _parse_prompt_file(md_path.read_text(encoding="utf-8"))
        yield (meta.get("key") or md_path.stem), meta, body


def _prompt_row_from_seed(key: str, meta: dict, body: str) -> tuple:
    return (
        key,
        meta.get("name") or key,
        meta.get("kind") or "domain",
        (meta.get("assetClass") or "").upper() or None,
        (meta.get("productFamily") or "").lower() or None,
        meta.get("scopeDescription") or "",
        body,
        1 if key in _PROTECTED_PROMPT_KEYS else 0,
        _now(),
    )


def _seed_prompts() -> None:
    for key, meta, body in _iter_prompt_seed_files():
        if db.execute("SELECT key FROM prompts WHERE key = ?", (key,)).fetchone() is not None:
            continue  # never overwrite an existing (possibly admin-edited) row
        db.execute(
            "INSERT INTO prompts (key, name, kind, asset_class, product_family, scope_description, body, is_protected, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            _prompt_row_from_seed(key, meta, body),
        )
    db.commit()


def reseed_prompt(key: str) -> Optional[dict]:
    """Force one prompt back to its on-disk seed file, discarding any admin edit.
    Returns the refreshed row, or None if `key` has no seed file. Used by
    POST /api/prompts/{key}/reset — the deliberate way to push a trimmed /
    corrected seed .md into a database that already has the old version."""
    for seed_key, meta, body in _iter_prompt_seed_files():
        if seed_key != key:
            continue
        row = _prompt_row_from_seed(key, meta, body)
        db.execute(
            "INSERT INTO prompts (key, name, kind, asset_class, product_family, scope_description, body, is_protected, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET "
            "name = excluded.name, kind = excluded.kind, asset_class = excluded.asset_class, "
            "product_family = excluded.product_family, scope_description = excluded.scope_description, "
            "body = excluded.body, updated_at = excluded.updated_at",
            row,
        )
        db.commit()
        return get_prompt(key)
    return None


def _row_to_prompt(row: sqlite3.Row) -> dict:
    return {
        "key": row["key"],
        "name": row["name"],
        "kind": row["kind"],
        "assetClass": row["asset_class"],
        "productFamily": row["product_family"],
        "scopeDescription": row["scope_description"],
        "body": row["body"],
        "isProtected": bool(row["is_protected"]),
        "updatedAt": row["updated_at"],
    }


def list_prompts() -> list[dict]:
    rows = db.execute(
        "SELECT * FROM prompts ORDER BY "
        "CASE kind WHEN 'router' THEN 0 WHEN 'common' THEN 1 ELSE 2 END, "
        "asset_class IS NOT NULL, asset_class, product_family IS NOT NULL, product_family, key"
    ).fetchall()
    return [_row_to_prompt(r) for r in rows]


def get_prompt(key: str) -> Optional[dict]:
    row = db.execute("SELECT * FROM prompts WHERE key = ?", (key,)).fetchone()
    return _row_to_prompt(row) if row else None


def find_domain_prompt(asset_class: Optional[str], product_family: Optional[str]) -> Optional[dict]:
    """One row lookup used by the resolution cascade — exact (class, family)
    match only. The cascade itself (services/prompt_resolver.py) decides the
    fallback order."""
    ac = (asset_class or "").upper() or None
    pf = (product_family or "").lower() or None
    if ac and pf:
        row = db.execute(
            "SELECT * FROM prompts WHERE kind = 'domain' AND asset_class = ? AND product_family = ?",
            (ac, pf),
        ).fetchone()
    elif ac:
        row = db.execute(
            "SELECT * FROM prompts WHERE kind = 'domain' AND asset_class = ? AND product_family IS NULL",
            (ac,),
        ).fetchone()
    else:
        row = None
    return _row_to_prompt(row) if row else None


def upsert_prompt(
    key: str,
    name: str,
    kind: str,
    asset_class: Optional[str],
    product_family: Optional[str],
    scope_description: str,
    body: str,
    updated_by: Optional[int],
) -> dict:
    existing = db.execute("SELECT is_protected FROM prompts WHERE key = ?", (key,)).fetchone()
    is_protected = existing["is_protected"] if existing else (1 if key in _PROTECTED_PROMPT_KEYS else 0)
    db.execute(
        """
        INSERT INTO prompts (key, name, kind, asset_class, product_family, scope_description, body, is_protected, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            asset_class = excluded.asset_class,
            product_family = excluded.product_family,
            scope_description = excluded.scope_description,
            body = excluded.body,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        """,
        (
            key,
            name,
            kind,
            (asset_class or "").upper() or None,
            (product_family or "").lower() or None,
            scope_description or "",
            body,
            is_protected,
            _now(),
            updated_by,
        ),
    )
    db.commit()
    return get_prompt(key)


def delete_prompt(key: str) -> bool:
    row = db.execute("SELECT is_protected FROM prompts WHERE key = ?", (key,)).fetchone()
    if row is None or row["is_protected"]:
        return False
    db.execute("DELETE FROM prompts WHERE key = ?", (key,))
    db.commit()
    return True


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
