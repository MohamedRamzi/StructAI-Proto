"""
FastAPI dependencies for auth: `require_auth` (human JWT login), `require_role`
(JWT + role check), and `require_api_key_or_auth` (accepts EITHER a service
API key `isk_...`, for the main Node app calling POST /api/analyze or
POST /api/instruments/search, OR a human JWT).

Raised HTTPExceptions carry a plain string `detail`; main.py's exception
handler reshapes that into the project-wide `{ "success": false, "error": ... }`
JSON contract, so routers here don't need to build that shape themselves.
"""
from fastapi import Depends, HTTPException, Request, status

from .. import db
from .jwt import verify_auth_token


def _extract_bearer(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def require_auth(request: Request) -> dict:
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise (en-tête Authorization: Bearer <token> manquant).")
    payload = verify_auth_token(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré.")
    return payload


def require_role(role: str):
    def dependency(user: dict = Depends(require_auth)) -> dict:
        if user.get("role") != role:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f'Droits insuffisants — rôle "{role}" requis.')
        return user

    return dependency


def require_api_key_or_auth(request: Request) -> dict:
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise (clé API ou token JWT).")

    if token.startswith("isk_"):
        key_id = db.verify_api_key_token(token)
        if not key_id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Clé API invalide ou révoquée.")
        return {"apiKeyId": key_id}

    payload = verify_auth_token(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré.")
    return payload
