from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_role

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"], dependencies=[Depends(require_role("admin"))])


class CreateApiKeyRequest(BaseModel):
    label: str


@router.get("")
def list_api_keys():
    return {"success": True, "apiKeys": db.list_api_keys()}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_api_key(payload: CreateApiKeyRequest, current: dict = Depends(require_role("admin"))):
    if not payload.label.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "label est requis.")
    record, plain_token = db.create_api_key(payload.label.strip(), current["userId"])
    # The plaintext token is only ever returned here, at creation time.
    return {"success": True, "apiKey": record, "token": plain_token}


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(key_id: int):
    db.revoke_api_key(key_id)
