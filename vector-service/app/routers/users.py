from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_role("admin"))])


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "user"


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None


@router.get("")
def list_users():
    return {"success": True, "users": db.list_users()}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(payload: CreateUserRequest):
    email = payload.email.strip().lower()
    role = "admin" if payload.role == "admin" else "user"

    if db.find_user_by_email(email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Un utilisateur avec cet email existe déjà.")
    if len(payload.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le mot de passe doit contenir au moins 8 caractères.")

    user = db.create_user(email, payload.password, role)
    return {"success": True, "user": {"id": user["id"], "email": user["email"], "role": user["role"], "createdAt": user["created_at"]}}


@router.patch("/{user_id}")
def update_user(user_id: int, payload: UpdateUserRequest):
    target = db.find_user_by_id(user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable.")

    if payload.role is not None and payload.role not in ("admin", "user"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'role doit être "admin" ou "user".')
    if target["role"] == "admin" and payload.role == "user" and db.count_admins() <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Impossible de retirer le rôle admin du dernier administrateur.")
    if payload.password is not None and len(payload.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le mot de passe doit contenir au moins 8 caractères.")

    updated = db.update_user(user_id, payload.role, payload.password)
    return {"success": True, "user": {"id": updated["id"], "email": updated["email"], "role": updated["role"], "createdAt": updated["created_at"]}}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, current: dict = Depends(require_auth)):
    target = db.find_user_by_id(user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable.")
    if current["userId"] == user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vous ne pouvez pas supprimer votre propre compte.")
    if target["role"] == "admin" and db.count_admins() <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Impossible de supprimer le dernier administrateur.")

    db.delete_user(user_id)
