"""
Environment configuration, loaded once at import time via python-dotenv.

`.env`, the SQLite file, and the Chroma persistent dir are all resolved
relative to this PACKAGE's own location (SERVICE_ROOT), not the process's
current working directory — a cwd-relative "./data/..." previously created a
second, empty database when this kind of service was launched from the repo
root instead of its own directory (see git history of vector-service's
config.py for the exact incident). Resolving everything against __file__
avoids that entire bug class.

This service replaces quotation-service (Node) and vector-service (Python):
one FastAPI app, one SQLite database, one set of users/API keys. Both LLM
needs (chat/analysis and embeddings) are served by vLLM, run as independent
`vllm serve` sidecar processes reached over HTTP (OpenAI-compatible API) —
see services/inference_client.py. This service itself has NO dependency on
vllm/vllm-metal; it only ever speaks HTTP to the two sidecars.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(SERVICE_ROOT / ".env")

PORT = int(os.environ.get("PORT", "4001"))
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@structai.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

# Bootstrap defaults for the chat/analysis provider — configurable afterwards
# from the admin UI (public/admin). LLM_PROVIDER is "openai_compatible" (any
# endpoint speaking the OpenAI chat-completions protocol — by default the
# local vLLM sidecar; in prod, the docker-compose vllm-chat service, see
# docker-compose.yml) or "gemini" (Google's cloud API, needs GEMINI_API_KEY or
# a key set later from the admin UI). Embeddings are always served by the
# vLLM sidecar (no cloud embedding provider is wired up).
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai_compatible")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8001/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.1"))
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip() or None
EMBEDDING_BASE_URL = os.environ.get("EMBEDDING_BASE_URL", "http://localhost:8002/v1")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")

# Seed directory for the routed-analyze pipeline's prompts (router, _common,
# and the per-scope domain prompts). Loaded into the `prompts` SQLite table on
# first boot (idempotent — see db._seed_prompts); the table is the runtime
# source of truth thereafter, editable from the admin UI. (Replaces the single
# QuotationPrompt.md the pre-refacto pipeline used.)
PROMPTS_DIR = SERVICE_ROOT / "prompts"

# Known-good chat / embedding provider configurations, offered as one-click
# presets in the admin UI ("Charger une configuration connue…") so you don't
# have to retype a local model name + vLLM URL every time you switch. Read
# fresh on each request from this JSON file if it exists (edit it to add your
# own — no restart needed), else the built-in list below is used. Selecting a
# preset only fills the form; you still click "Enregistrer" to apply it, and it
# never touches a stored API key.
LLM_PRESETS_PATH = SERVICE_ROOT / "llm-presets.json"

BUILTIN_LLM_PRESETS = {
    "chat": [
        {
            "label": "vLLM local — Qwen3-4B-Instruct (port 8001)",
            "provider": "openai_compatible",
            "model": "Qwen/Qwen3-4B-Instruct-2507",
            "baseUrl": "http://localhost:8001/v1",
            "temperature": 0.1,
        },
        {
            "label": "LM Studio local (port 1234)",
            "provider": "openai_compatible",
            "model": "local-model",
            "baseUrl": "http://localhost:1234/v1",
            "temperature": 0.1,
        },
        {
            "label": "Ollama local — endpoint OpenAI-compatible (port 11434)",
            "provider": "openai_compatible",
            "model": "qwen3:4b",
            "baseUrl": "http://localhost:11434/v1",
            "temperature": 0.1,
        },
        {
            "label": "Google Gemini Flash (cloud — clé API requise)",
            "provider": "gemini",
            "model": "gemini-flash-latest",
            "baseUrl": "",
            "temperature": 0.1,
        },
    ],
    "embedding": [
        {
            "label": "vLLM local — Qwen3-Embedding-0.6B (port 8002)",
            "model": "Qwen/Qwen3-Embedding-0.6B",
            "baseUrl": "http://localhost:8002/v1",
        },
    ],
}

DB_PATH = os.environ.get("DB_PATH") or str(SERVICE_ROOT / "data" / "inference-service.db")
CHROMA_PATH = os.environ.get("CHROMA_PATH") or str(SERVICE_ROOT / "data" / "chroma")
DEBUG = os.environ.get("DEBUG", "false").lower() in ("true", "1")

# Ensure the data directories exist before sqlite3/chromadb try to open them.
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)
