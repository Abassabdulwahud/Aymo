import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..config import get_settings
from ..models.mongo_models import UserDoc, utc_now_iso
from ..mongodb import get_mongo_db
from ..repositories.mongo_repository import UserMongoRepository
from ..schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    OAuthRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)
from ..services.translation_service import DEFAULT_LANGUAGE_CODE, normalize_language_code, translate
from ..utils.emailing import build_password_reset_link, password_reset_email_ready, send_password_reset_email
from ..utils.oauth import verify_apple_oauth_token, verify_google_oauth_token
from ..utils.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


async def _language_for_email_mongo(email: str) -> str:
    db = get_mongo_db()
    if db is not None:
        user_repo = UserMongoRepository(db)
        user = await user_repo.get_by_email(email.lower().strip())
        if user and user.preferred_language:
            return normalize_language_code(user.preferred_language)
    return DEFAULT_LANGUAGE_CODE


def _apple_provider_meta():
    if not settings.apple_client_id:
        return {
            "configured": False,
            "enabled": False,
            "clientId": None,
            "redirectUri": None,
            "reason": "Apple sign-in needs APPLE_CLIENT_ID in the backend .env file.",
        }

    if not settings.apple_redirect_uri:
        return {
            "configured": True,
            "enabled": False,
            "clientId": settings.apple_client_id,
            "redirectUri": None,
            "reason": "Apple sign-in also needs APPLE_REDIRECT_URI in the backend .env file.",
        }

    parsed = urlparse(settings.apple_redirect_uri)
    host = (parsed.hostname or "").lower()
    is_local_host = host in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" or is_local_host:
        return {
            "configured": True,
            "enabled": False,
            "clientId": settings.apple_client_id,
            "redirectUri": settings.apple_redirect_uri,
            "reason": "Apple web sign-in requires an HTTPS redirect URI on a real verified domain.",
        }

    return {
        "configured": True,
        "enabled": True,
        "clientId": settings.apple_client_id,
        "redirectUri": settings.apple_redirect_uri,
        "reason": None,
    }


@router.get("/providers")
def auth_providers():
    google_ready = bool(settings.google_client_id)
    return {
        "google": {
            "configured": google_ready,
            "enabled": google_ready,
            "clientId": settings.google_client_id,
            "reason": None if google_ready else "Google sign-in needs GOOGLE_CLIENT_ID in the backend .env file.",
        },
        "apple": _apple_provider_meta(),
        "passwordResetEmail": {
            "configured": password_reset_email_ready(),
            "enabled": password_reset_email_ready(),
            "clientId": None,
            "redirectUri": settings.password_reset_base_url,
            "reason": None
            if password_reset_email_ready()
            else "Password reset email needs SMTP settings and PASSWORD_RESET_BASE_URL in the backend .env file.",
        },
    }


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, response: Response):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    email = payload.email.lower().strip()
    existing = await user_repo.get_by_email(email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=translate(DEFAULT_LANGUAGE_CODE, "email_exists"))

    user_doc = UserDoc(
        id=str(uuid.uuid4()),
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        provider="email",
        created_at=utc_now_iso(),
        last_login_at=utc_now_iso(),
    )
    try:
        await user_repo.create(user_doc)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=translate(DEFAULT_LANGUAGE_CODE, "email_exists")) from exc

    response.headers["X-AYMO-Message"] = translate(DEFAULT_LANGUAGE_CODE, "register_success")
    return UserResponse(
        id=user_doc.id,
        email=user_doc.email,
        full_name=user_doc.full_name,
        preferred_ai_provider=user_doc.preferred_ai_provider,
        preferred_theme=user_doc.preferred_theme,
        preferred_language=user_doc.preferred_language,
        provider=user_doc.provider,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    email = payload.email.lower().strip()
    language_code = await _language_for_email_mongo(email)

    user_doc = await user_repo.get_by_email(email)
    if not user_doc or not user_doc.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=translate(language_code, "login_failed"))

    if not verify_password(payload.password, user_doc.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=translate(language_code, "login_failed"))

    token = create_access_token(user_doc.email)

    try:
        await user_repo.update_last_login(user_doc.id)
    except Exception:
        pass

    response.headers["X-AYMO-Message"] = translate(language_code, "login_success")
    return TokenResponse(access_token=token)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(payload: ForgotPasswordRequest):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    email = payload.email.lower().strip()
    language_code = await _language_for_email_mongo(email)
    user_doc = await user_repo.get_by_email(email)
    reset_token = None
    reset_url = None
    email_delivery_used = False
    if user_doc and user_doc.password_hash:
        reset_token = create_password_reset_token(user_doc.email)
        reset_url = build_password_reset_link(reset_token)
        if password_reset_email_ready() and reset_url:
            try:
                send_password_reset_email(user_doc.email, reset_url)
                email_delivery_used = True
            except Exception as exc:
                detail = translate(language_code, "password_reset_failed")
                if settings.app_env == "development":
                    detail = f"{detail} {exc}"
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from exc

    response = ForgotPasswordResponse(
        message=translate(language_code, "password_reset_prepared"),
    )
    if settings.app_env == "development" and reset_token and not email_delivery_used:
        response.reset_token = reset_token
        response.reset_url = reset_url
    return response


@router.post("/reset-password", response_model=TokenResponse)
async def reset_password(payload: ResetPasswordRequest, response: Response):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    try:
        token_data = decode_password_reset_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    email = (token_data.get("sub") or "").lower().strip()
    language_code = await _language_for_email_mongo(email)
    user_doc = await user_repo.get_by_email(email)
    if not user_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=translate(language_code, "user_not_found"))

    new_hash = hash_password(payload.new_password)
    await user_repo.update_password_hash(user_doc.id, new_hash)
    token = create_access_token(user_doc.email)

    try:
        await user_repo.update_last_login(user_doc.id)
    except Exception:
        pass

    response.headers["X-AYMO-Message"] = translate(language_code, "password_reset_success")
    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
async def google_sign_in(payload: OAuthRequest, response: Response):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    try:
        raw_email = verify_google_oauth_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=translate(DEFAULT_LANGUAGE_CODE, "invalid_oauth")) from exc

    email = raw_email.lower().strip()
    user_doc = await user_repo.get_by_email(email)
    if not user_doc:
        fallback_name = email.split("@")[0].replace(".", " ").replace("_", " ").strip().title()
        user_doc = UserDoc(
            id=str(uuid.uuid4()),
            email=email,
            full_name=fallback_name or None,
            password_hash=None,
            provider="google",
            created_at=utc_now_iso(),
            last_login_at=utc_now_iso(),
        )
        try:
            await user_repo.create(user_doc)
        except ValueError:
            user_doc = await user_repo.get_by_email(email)
    else:
        try:
            await user_repo.update_last_login(user_doc.id)
        except Exception:
            pass

    language_code = normalize_language_code(user_doc.preferred_language) if (user_doc and user_doc.preferred_language) else DEFAULT_LANGUAGE_CODE
    response.headers["X-AYMO-Message"] = translate(language_code, "login_success")
    return TokenResponse(access_token=create_access_token(email))


@router.post("/apple", response_model=TokenResponse)
async def apple_sign_in(payload: OAuthRequest, response: Response):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    try:
        raw_email = verify_apple_oauth_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=translate(DEFAULT_LANGUAGE_CODE, "invalid_oauth")) from exc

    email = raw_email.lower().strip()
    user_doc = await user_repo.get_by_email(email)
    if not user_doc:
        fallback_name = email.split("@")[0].replace(".", " ").replace("_", " ").strip().title()
        user_doc = UserDoc(
            id=str(uuid.uuid4()),
            email=email,
            full_name=fallback_name or None,
            password_hash=None,
            provider="apple",
            created_at=utc_now_iso(),
            last_login_at=utc_now_iso(),
        )
        try:
            await user_repo.create(user_doc)
        except ValueError:
            user_doc = await user_repo.get_by_email(email)
    else:
        try:
            await user_repo.update_last_login(user_doc.id)
        except Exception:
            pass

    language_code = normalize_language_code(user_doc.preferred_language) if (user_doc and user_doc.preferred_language) else DEFAULT_LANGUAGE_CODE
    response.headers["X-AYMO-Message"] = translate(language_code, "login_success")
    return TokenResponse(access_token=create_access_token(email))
