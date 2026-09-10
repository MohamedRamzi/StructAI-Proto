"""Admin CRUD for the routed-analyze pipeline's prompts (router, _common, and
the per-scope domain prompts). Any authenticated user can read; only an admin
can write. The seeded `router`/`_common`/`default` rows can be edited but not
deleted."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/prompts", tags=["prompts"])

_VALID_KINDS = {"router", "common", "domain"}
_VALID_ASSET_CLASSES = {"EQUITY", "RATES", "FX", "CREDIT"}


class UpsertPromptRequest(BaseModel):
    name: str
    kind: str = "domain"
    assetClass: Optional[str] = None
    productFamily: Optional[str] = None
    scopeDescription: str = ""
    body: str


@router.get("", dependencies=[Depends(require_auth)])
def list_prompts():
    return {"success": True, "prompts": db.list_prompts()}


@router.get("/{key}", dependencies=[Depends(require_auth)])
def get_prompt(key: str):
    prompt = db.get_prompt(key)
    if not prompt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt introuvable.")
    return {"success": True, "prompt": prompt}


@router.put("/{key}")
def upsert_prompt(key: str, payload: UpsertPromptRequest, current: dict = Depends(require_role("admin"))):
    if not key.strip() or "/" in key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "key invalide.")
    if payload.kind not in _VALID_KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"kind invalide. Valeurs autorisées : {', '.join(sorted(_VALID_KINDS))}.")
    asset_class = (payload.assetClass or "").upper() or None
    if asset_class is not None and asset_class not in _VALID_ASSET_CLASSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"assetClass invalide. Valeurs autorisées : {', '.join(sorted(_VALID_ASSET_CLASSES))}.")
    if not payload.body.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "body est requis.")

    existing = db.get_prompt(key)
    if existing and existing["isProtected"] and payload.kind != existing["kind"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le 'kind' d'un prompt protégé ne peut pas être modifié.")

    prompt = db.upsert_prompt(
        key.strip(), payload.name.strip(), payload.kind, asset_class,
        payload.productFamily, payload.scopeDescription, payload.body, current["userId"],
    )
    return {"success": True, "prompt": prompt}


@router.post("/{key}/reset")
def reset_prompt_to_seed(key: str, _current: dict = Depends(require_role("admin"))):
    """Discard the stored body and reload this prompt from its seed .md file —
    the way to pick up a trimmed / corrected seed in a database that already
    has the old version. 404 if `key` has no seed file (nothing to reset to)."""
    refreshed = db.reseed_prompt(key)
    if refreshed is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Aucun fichier seed pour « {key} » dans inference-service/prompts/ — rien à réinitialiser.",
        )
    return {"success": True, "prompt": refreshed}


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(key: str, current: dict = Depends(require_role("admin"))):
    prompt = db.get_prompt(key)
    if not prompt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt introuvable.")
    if not db.delete_prompt(key):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ce prompt est protégé et ne peut pas être supprimé.")
