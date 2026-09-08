from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .routers import analyze, api_keys, auth, embedding_config, instruments, llm_config, status, users

CURRENT_DIR = Path(__file__).resolve().parent

app = FastAPI(title="inference-service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    """Reshapes FastAPI's default {"detail": ...} into this project's
    {"success": false, "error": ...} convention, shared with the main Node app."""
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


app.include_router(status.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(llm_config.router)
app.include_router(embedding_config.router)
app.include_router(api_keys.router)
app.include_router(analyze.router)
app.include_router(instruments.router)

# Static admin UI (plain HTML/CSS/JS, no build step) — served at /admin/*.
app.mount("/admin", StaticFiles(directory=str(CURRENT_DIR.parent / "public" / "admin"), html=True), name="admin")
