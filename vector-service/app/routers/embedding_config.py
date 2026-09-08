from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/config", tags=["config"])


class UpdateEmbeddingConfigRequest(BaseModel):
    model: Optional[str] = None
    baseUrl: Optional[str] = None


@router.get("/embedding", dependencies=[Depends(require_auth)])
def get_embedding_config():
    return {"success": True, "config": db.get_embedding_config()}


@router.put("/embedding")
def update_embedding_config(payload: UpdateEmbeddingConfigRequest, current: dict = Depends(require_role("admin"))):
    updated = db.update_embedding_config(payload.model, payload.baseUrl, current["userId"])
    return {"success": True, "config": updated}
