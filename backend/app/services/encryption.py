import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from ..config import get_settings


def _build_fernet_key() -> bytes:
    settings = get_settings()
    raw_key = (settings.content_encryption_key or "").strip()
    if raw_key:
        try:
            return raw_key.encode("utf-8")
        except Exception as exc:
            raise RuntimeError("CONTENT_ENCRYPTION_KEY is invalid.") from exc

    digest = hashlib.sha256(settings.jwt_secret_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


@lru_cache
def get_cipher() -> Fernet:
    return Fernet(_build_fernet_key())


def encrypt_text(value: str) -> str:
    if not value:
        return ""
    return get_cipher().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(value: str) -> str:
    if not value:
        return ""
    try:
        return get_cipher().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored encrypted content could not be decrypted.") from exc
