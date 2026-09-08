"""
Environment configuration, loaded once at import time via python-dotenv.

`.env`, the SQLite file, and the Chroma persistent dir are all resolved
relative to this PACKAGE's own location (SERVICE_ROOT), not the process's
current working directory: `dev:all` at the repo root launches this service
via a raw `python run.py` (no guaranteed `cd vector-service` first), and a
cwd-relative "./data/..." silently created a second, empty database at the
repo root instead of vector-service/data/ — same bug class avoided by
resolving everything against __file__ instead of trusting the caller's cwd.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(SERVICE_ROOT / ".env")

PORT = int(os.environ.get("PORT", "4002"))
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@structai.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "qwen3-embedding")
DB_PATH = os.environ.get("DB_PATH") or str(SERVICE_ROOT / "data" / "vector-service.db")
CHROMA_PATH = os.environ.get("CHROMA_PATH") or str(SERVICE_ROOT / "data" / "chroma")
DEBUG = os.environ.get("DEBUG", "false").lower() in ("true", "1")

# Ensure the data directories exist before sqlite3/chromadb try to open them.
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)
