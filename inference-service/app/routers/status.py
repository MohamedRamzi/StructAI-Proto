from fastapi import APIRouter

from .. import db

router = APIRouter(prefix="/api", tags=["status"])


@router.get("/health")
def health():
    return {"ok": True, "service": "inference-service"}


@router.get("/status")
def public_status():
    """Public, no-secret status — lets the main app show engine badges without auth."""
    llm = db.get_llm_settings()
    embedding = db.get_embedding_settings()
    return {"success": True, "chatModel": llm["model"], "embeddingModel": embedding["model"]}
