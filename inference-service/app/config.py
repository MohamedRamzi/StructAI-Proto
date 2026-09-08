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

# Bootstrap defaults for the two vLLM sidecars — configurable afterwards from
# the admin UI (public/admin), same pattern as quotation-service/vector-service's
# Gemini/Ollama settings used to be. In dev these point at `vllm serve` running
# locally via the vllm-metal venv; in prod, at the docker-compose vllm-chat /
# vllm-embed services (see docker-compose.yml).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8001/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.1"))
EMBEDDING_BASE_URL = os.environ.get("EMBEDDING_BASE_URL", "http://localhost:8002/v1")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")

QUOTATION_PROMPT_PATH = SERVICE_ROOT / "QuotationPrompt.md"

DB_PATH = os.environ.get("DB_PATH") or str(SERVICE_ROOT / "data" / "inference-service.db")
CHROMA_PATH = os.environ.get("CHROMA_PATH") or str(SERVICE_ROOT / "data" / "chroma")
DEBUG = os.environ.get("DEBUG", "false").lower() in ("true", "1")

# Ensure the data directories exist before sqlite3/chromadb try to open them.
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)
