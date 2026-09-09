"""Verifies that an existing db created before `provider`/`api_key` existed on
llm_settings (i.e. every db from before multi-provider support was restored)
gets upgraded in place on the next boot, without losing its existing model/
baseUrl/temperature — CREATE TABLE IF NOT EXISTS never adds columns to an
already-existing table, so this migration path is the only thing that makes
old databases keep working."""
import sqlite3
import sys


def _fresh_db_module(monkeypatch, db_path):
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("CHROMA_PATH", str(db_path.parent / "chroma"))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("ADMIN_EMAIL", "admin@test.local")
    monkeypatch.setenv("ADMIN_PASSWORD", "admin-test-password")
    for mod_name in list(sys.modules):
        if mod_name == "app" or mod_name.startswith("app."):
            del sys.modules[mod_name]
    import app.db as db_module
    return db_module


def test_legacy_llm_settings_table_is_migrated_in_place(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"

    # Simulate a pre-multi-provider database: llm_settings without provider/api_key,
    # already carrying a real admin-configured model/baseUrl/temperature.
    legacy_conn = sqlite3.connect(db_path)
    legacy_conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL
        );
        CREATE TABLE llm_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            model TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            temperature REAL NOT NULL DEFAULT 0.1,
            updated_at TEXT NOT NULL,
            updated_by INTEGER REFERENCES users(id)
        );
        """
    )
    legacy_conn.execute(
        "INSERT INTO llm_settings (id, model, base_url, temperature, updated_at) VALUES (1, 'legacy-model', 'http://legacy:8001/v1', 0.42, '2026-01-01T00:00:00+00:00')"
    )
    legacy_conn.commit()
    legacy_conn.close()

    db_module = _fresh_db_module(monkeypatch, db_path)

    cols = {row["name"] for row in db_module.db.execute("PRAGMA table_info(llm_settings)").fetchall()}
    assert {"provider", "api_key"}.issubset(cols)

    settings = db_module.get_llm_settings()
    # Pre-existing values survive the migration untouched...
    assert settings["model"] == "legacy-model"
    assert settings["baseUrl"] == "http://legacy:8001/v1"
    assert settings["temperature"] == 0.42
    # ...and the new columns get sane, backward-compatible defaults.
    assert settings["provider"] == "openai_compatible"
    assert settings["apiKey"] is None
