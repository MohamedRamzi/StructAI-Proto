"""Admin config for the chat/analysis vLLM sidecar (baseUrl, model, temperature)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/config", tags=["config"])


class UpdateLlmConfigRequest(BaseModel):
    model: Optional[str] = None
    baseUrl: Optional[str] = None
    temperature: Optional[float] = None


@router.get("/llm", dependencies=[Depends(require_auth)])
def get_llm_config():
    return {"success": True, "config": db.get_llm_settings()}


@router.put("/llm")
def update_llm_config(payload: UpdateLlmConfigRequest, current: dict = Depends(require_role("admin"))):
    if payload.temperature is not None and not (0 <= payload.temperature <= 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "temperature doit être un nombre entre 0 et 2.")
    updated = db.update_llm_settings(payload.model, payload.baseUrl, payload.temperature, current["userId"])
    return {"success": True, "config": updated}
