from fastapi import APIRouter

from .. import db

router = APIRouter(prefix="/api", tags=["status"])


@router.get("/health")
def health():
    return {"ok": True, "service": "vector-service"}


@router.get("/status")
def public_status():
    cfg = db.get_embedding_config()
    return {"success": True, "provider": cfg["provider"], "model": cfg["model"]}
