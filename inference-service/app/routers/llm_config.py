"""Admin config for the chat/analysis provider: an OpenAI-compatible endpoint
(local vLLM sidecar by default, but any provider speaking that protocol) or
Google Gemini, given an API key. The stored API key is never returned in
plaintext — GET/PUT both redact it to a `hasApiKey` boolean, matching the
pattern quotation-service used before this project's vLLM merge.

Also serves the one-click provider presets (config.LLM_PRESETS_PATH, else
config.BUILTIN_LLM_PRESETS) the admin UI offers so you don't retype a local
model name + vLLM URL on every switch."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import config, db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/config", tags=["config"])

VALID_PROVIDERS = {"openai_compatible", "gemini"}
VALID_REASONING_MODES = {"auto", "fast", "thinking"}


def _load_presets() -> dict:
    """Read the presets JSON file fresh (so edits show without a restart);
    fall back to the built-in list if it's missing or unreadable."""
    path = config.LLM_PRESETS_PATH
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return {"chat": list(data.get("chat") or []), "embedding": list(data.get("embedding") or [])}
        except (ValueError, OSError):
            pass
    return config.BUILTIN_LLM_PRESETS


class UpdateLlmConfigRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None
    temperature: Optional[float] = None
    reasoningMode: Optional[str] = None


def _redact(cfg: dict) -> dict:
    return {
        "provider": cfg["provider"],
        "model": cfg["model"],
        "baseUrl": cfg["baseUrl"],
        "temperature": cfg["temperature"],
        "reasoningMode": cfg.get("reasoningMode", "auto"),
        "hasApiKey": bool(cfg["apiKey"]),
        "updatedAt": cfg["updatedAt"],
    }


@router.get("/llm", dependencies=[Depends(require_auth)])
def get_llm_config():
    return {"success": True, "config": _redact(db.get_llm_settings())}


@router.get("/presets", dependencies=[Depends(require_auth)])
def get_config_presets():
    """Known chat + embedding provider configs, for the admin UI's
    "Charger une configuration connue…" dropdowns."""
    return {"success": True, "presets": _load_presets()}


@router.put("/llm")
def update_llm_config(payload: UpdateLlmConfigRequest, current: dict = Depends(require_role("admin"))):
    if payload.provider is not None and payload.provider not in VALID_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"provider invalide. Valeurs autorisées : {', '.join(sorted(VALID_PROVIDERS))}.")
    if payload.temperature is not None and not (0 <= payload.temperature <= 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "temperature doit être un nombre entre 0 et 2.")
    if payload.reasoningMode is not None and payload.reasoningMode not in VALID_REASONING_MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"reasoningMode invalide. Valeurs autorisées : {', '.join(sorted(VALID_REASONING_MODES))}.")

    # apiKey omitted entirely (None) -> keep the existing key. apiKey: "" explicitly -> clear it.
    update_kwargs = {} if payload.apiKey is None else {"api_key": (payload.apiKey or None)}
    updated = db.update_llm_settings(
        payload.provider, payload.model, payload.baseUrl,
        temperature=payload.temperature, updated_by=current["userId"],
        reasoning_mode=payload.reasoningMode, **update_kwargs,
    )
    return {"success": True, "config": _redact(updated)}
