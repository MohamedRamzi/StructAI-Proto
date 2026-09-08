from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth
from ..auth.jwt import sign_auth_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(payload: LoginRequest):
    user = db.verify_user_credentials(payload.email.strip().lower(), payload.password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email ou mot de passe incorrect.")

    token = sign_auth_token(user["id"], user["email"], user["role"])
    return {
        "success": True,
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "role": user["role"]},
    }


@router.get("/me")
def me(current: dict = Depends(require_auth)):
    user = db.find_user_by_id(current["userId"])
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable.")
    return {"success": True, "user": {"id": user["id"], "email": user["email"], "role": user["role"], "createdAt": user["created_at"]}}
