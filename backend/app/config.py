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
        # Let later lines in the same .env file override earlier ones.
        os.environ[key] = value


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    database_url: str
    uploads_dir: str
    uploads_base_url: str
    image_max_dimension: int
    image_quality: int
    database_pool_size: int
    database_max_overflow: int
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
    tesseract_cmd: Optional[str]
    vision_api_url: Optional[str]
    vision_api_key: Optional[str]
    content_encryption_key: Optional[str]
    redis_url: Optional[str]
    celery_broker_url: Optional[str]
    celery_result_backend: Optional[str]
    celery_task_always_eager: bool
    ai_cache_ttl_seconds: int
    transcription_cache_ttl_seconds: int
    ai_memory_window_size: int
    ai_max_context_tokens: int
    openai_api_key: Optional[str]
    openai_model: str
    gemini_api_key: Optional[str]
    gemini_model: str
    deepseek_api_key: Optional[str]
    deepseek_model: str
    transcription_provider: str
    transcription_model: str
    # Storage provider
    file_storage_provider: str
    cloudinary_cloud_name: Optional[str]
    cloudinary_api_key: Optional[str]
    cloudinary_api_secret: Optional[str]
    cloudinary_folder: Optional[str]


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
        uploads_dir=os.getenv("UPLOADS_DIR", "uploads"),
        uploads_base_url=os.getenv("UPLOADS_BASE_URL", "/uploads"),
        image_max_dimension=int(os.getenv("IMAGE_MAX_DIMENSION", "1600")),
        image_quality=int(os.getenv("IMAGE_QUALITY", "82")),
        database_pool_size=int(os.getenv("DATABASE_POOL_SIZE", "10")),
        database_max_overflow=int(os.getenv("DATABASE_MAX_OVERFLOW", "20")),
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
        tesseract_cmd=os.getenv("TESSERACT_CMD"),
        vision_api_url=os.getenv("VISION_API_URL"),
        vision_api_key=os.getenv("VISION_API_KEY"),
        content_encryption_key=os.getenv("CONTENT_ENCRYPTION_KEY"),
        redis_url=os.getenv("REDIS_URL"),
        celery_broker_url=os.getenv("CELERY_BROKER_URL"),
        celery_result_backend=os.getenv("CELERY_RESULT_BACKEND"),
        celery_task_always_eager=os.getenv("CELERY_TASK_ALWAYS_EAGER", "").strip().lower() in {"1", "true", "yes"},
        ai_cache_ttl_seconds=int(os.getenv("AI_CACHE_TTL_SECONDS", "900")),
        transcription_cache_ttl_seconds=int(os.getenv("TRANSCRIPTION_CACHE_TTL_SECONDS", "86400")),
        ai_memory_window_size=int(os.getenv("AI_MEMORY_WINDOW_SIZE", "10")),
        ai_max_context_tokens=int(os.getenv("AI_MAX_CONTEXT_TOKENS", "12000")),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        deepseek_api_key=os.getenv("DEEPSEEK_API_KEY"),
        deepseek_model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        transcription_provider=os.getenv("TRANSCRIPTION_PROVIDER", "faster_whisper"),
        transcription_model=os.getenv("TRANSCRIPTION_MODEL", "small"),
        file_storage_provider=os.getenv("FILE_STORAGE_PROVIDER", "local").strip().lower(),
        cloudinary_cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
        cloudinary_api_key=os.getenv("CLOUDINARY_API_KEY"),
        cloudinary_api_secret=os.getenv("CLOUDINARY_API_SECRET"),
        cloudinary_folder=os.getenv("CLOUDINARY_FOLDER", "aymo"),
    )
