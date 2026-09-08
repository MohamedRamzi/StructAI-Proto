"""
Password hashing — using the `bcrypt` library directly rather than passlib:
passlib is unmaintained and its bcrypt backend breaks on bcrypt>=4.1 (it reads
an internal `__about__.__version__` attribute bcrypt removed). Calling bcrypt
directly is simple enough that the wrapper isn't worth the compatibility risk
— mirrors quotation-service's choice to use bcryptjs directly on the Node side.
"""
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False
