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


def test_prompts_table_is_created_and_seeded_on_a_db_that_predates_it(tmp_path, monkeypatch):
    """A db restored from before the routed-analyze refactor has no `prompts`
    table at all. `CREATE TABLE IF NOT EXISTS` + `_seed_prompts()` must bring it
    up to date on the next boot, without touching the existing user row."""
    db_path = tmp_path / "pre-refacto.db"

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
        """
    )
    legacy_conn.execute(
        "INSERT INTO users (email, password_hash, role, created_at) VALUES ('admin@test.local', 'x', 'admin', '2026-01-01T00:00:00+00:00')"
    )
    legacy_conn.commit()
    legacy_conn.close()

    db_module = _fresh_db_module(monkeypatch, db_path)

    tables = {row["name"] for row in db_module.db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "prompts" in tables

    keys = {p["key"] for p in db_module.list_prompts()}
    assert {"router", "_common", "default", "equity-autocall", "rates"}.issubset(keys)

    # the pre-existing admin was not disturbed / re-bootstrapped
    assert db_module.db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] == 1


def test_prompt_seed_is_idempotent_across_reboots(tmp_path, monkeypatch):
    db_path = tmp_path / "reboot.db"

    first = _fresh_db_module(monkeypatch, db_path)
    count_after_first = first.db.execute("SELECT COUNT(*) AS c FROM prompts").fetchone()["c"]
    assert count_after_first >= 8

    second = _fresh_db_module(monkeypatch, db_path)
    count_after_second = second.db.execute("SELECT COUNT(*) AS c FROM prompts").fetchone()["c"]
    assert count_after_second == count_after_first
