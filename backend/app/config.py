from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import os
import secrets
from typing import Optional


def _load_dotenv_file() -> None:
    env_path = Path(".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    database_url: str
    jwt_secret_key: str
    jwt_algorithm: str
    jwt_expire_minutes: int
    password_reset_expire_minutes: int
    password_reset_base_url: Optional[str]
    smtp_host: Optional[str]
    smtp_port: int
    smtp_username: Optional[str]
    smtp_password: Optional[str]
    smtp_from_email: Optional[str]
    smtp_from_name: Optional[str]
    smtp_use_tls: bool
    google_client_id: Optional[str]
    apple_client_id: Optional[str]
    apple_redirect_uri: Optional[str]


def _resolve_jwt_secret_key(app_env: str) -> str:
    configured = os.getenv("JWT_SECRET_KEY", "").strip()
    if configured:
        return configured

    if app_env != "development":
        raise RuntimeError("JWT_SECRET_KEY must be configured outside development.")

    secret_path = Path(".dev_jwt_secret")
    if secret_path.exists():
        return secret_path.read_text(encoding="utf-8").strip()

    generated = secrets.token_urlsafe(48)
    secret_path.write_text(generated, encoding="utf-8")
    return generated


@lru_cache
def get_settings() -> Settings:
    _load_dotenv_file()
    app_env = os.getenv("APP_ENV", "development")

    return Settings(
        app_name=os.getenv("APP_NAME", "AYMO Notebook API"),
        app_env=app_env,
        database_url=os.getenv("DATABASE_URL", ""),
        jwt_secret_key=_resolve_jwt_secret_key(app_env),
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        jwt_expire_minutes=int(os.getenv("JWT_EXPIRE_MINUTES", "60")),
        password_reset_expire_minutes=int(os.getenv("PASSWORD_RESET_EXPIRE_MINUTES", "15")),
        password_reset_base_url=os.getenv("PASSWORD_RESET_BASE_URL"),
        smtp_host=os.getenv("SMTP_HOST"),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        smtp_username=os.getenv("SMTP_USERNAME"),
        smtp_password=os.getenv("SMTP_PASSWORD"),
        smtp_from_email=os.getenv("SMTP_FROM_EMAIL"),
        smtp_from_name=os.getenv("SMTP_FROM_NAME"),
        smtp_use_tls=os.getenv("SMTP_USE_TLS", "true").strip().lower() not in {"0", "false", "no"},
        google_client_id=os.getenv("GOOGLE_CLIENT_ID"),
        apple_client_id=os.getenv("APPLE_CLIENT_ID"),
        apple_redirect_uri=os.getenv("APPLE_REDIRECT_URI"),
    )
