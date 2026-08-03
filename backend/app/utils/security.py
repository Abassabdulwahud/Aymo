from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt_lib
from jose import JWTError, jwt

from ..config import get_settings

settings = get_settings()

_BCRYPT_ROUNDS = 12


def _password_bytes(password: str) -> bytes:
    """Encode and truncate password to 72 bytes (bcrypt hard limit)."""
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    """Return a bcrypt hash of *password* as a UTF-8 string."""
    salt = _bcrypt_lib.gensalt(rounds=_BCRYPT_ROUNDS)
    hashed = _bcrypt_lib.hashpw(_password_bytes(password), salt)
    # bcrypt 4.x returns bytes; bcrypt 3.x returns str — normalise to str.
    return hashed.decode("utf-8") if isinstance(hashed, bytes) else hashed


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Return True if *plain_password* matches *password_hash*."""
    try:
        pw_bytes = _password_bytes(plain_password)
        hash_bytes = password_hash.encode("utf-8") if isinstance(password_hash, str) else password_hash
        return _bcrypt_lib.checkpw(pw_bytes, hash_bytes)
    except Exception:
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": subject, "exp": expire, "purpose": "access"}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_password_reset_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_expire_minutes)
    payload = {"sub": subject, "exp": expire, "purpose": "password_reset"}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Invalid or expired token.") from exc

    if payload.get("purpose") != "access":
        raise ValueError("Invalid or expired token.")
    return payload


def decode_password_reset_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Invalid or expired reset token.") from exc

    if payload.get("purpose") != "password_reset":
        raise ValueError("Invalid or expired reset token.")
    return payload
