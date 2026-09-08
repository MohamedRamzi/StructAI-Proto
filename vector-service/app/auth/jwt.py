from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

from .. import config

ALGORITHM = "HS256"
EXPIRES_DELTA = timedelta(hours=12)


def sign_auth_token(user_id: int, email: str, role: str) -> str:
    if not config.JWT_SECRET:
        raise RuntimeError("JWT_SECRET n'est pas configuré (voir vector-service/.env.example).")
    payload = {
        "userId": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + EXPIRES_DELTA,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=ALGORITHM)


def verify_auth_token(token: str) -> Optional[dict]:
    if not config.JWT_SECRET:
        return None
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        return None
