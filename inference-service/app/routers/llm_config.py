"""Admin config for the chat/analysis provider: an OpenAI-compatible endpoint
(local vLLM sidecar by default, but any provider speaking that protocol) or
Google Gemini, given an API key. The stored API key is never returned in
plaintext — GET/PUT both redact it to a `hasApiKey` boolean, matching the
pattern quotation-service used before this project's vLLM merge."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/config", tags=["config"])

VALID_PROVIDERS = {"openai_compatible", "gemini"}


class UpdateLlmConfigRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None
    temperature: Optional[float] = None


def _redact(cfg: dict) -> dict:
    return {
        "provider": cfg["provider"],
        "model": cfg["model"],
        "baseUrl": cfg["baseUrl"],
        "temperature": cfg["temperature"],
        "hasApiKey": bool(cfg["apiKey"]),
        "updatedAt": cfg["updatedAt"],
    }


@router.get("/llm", dependencies=[Depends(require_auth)])
def get_llm_config():
    return {"success": True, "config": _redact(db.get_llm_settings())}


@router.put("/llm")
def update_llm_config(payload: UpdateLlmConfigRequest, current: dict = Depends(require_role("admin"))):
    if payload.provider is not None and payload.provider not in VALID_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"provider invalide. Valeurs autorisées : {', '.join(sorted(VALID_PROVIDERS))}.")
    if payload.temperature is not None and not (0 <= payload.temperature <= 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "temperature doit être un nombre entre 0 et 2.")

    # apiKey omitted entirely (None) -> keep the existing key. apiKey: "" explicitly -> clear it.
    update_kwargs = {} if payload.apiKey is None else {"api_key": (payload.apiKey or None)}
    updated = db.update_llm_settings(
        payload.provider, payload.model, payload.baseUrl,
        temperature=payload.temperature, updated_by=current["userId"], **update_kwargs,
    )
    return {"success": True, "config": _redact(updated)}
