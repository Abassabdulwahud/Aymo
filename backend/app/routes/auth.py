from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models.user import User
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
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists.")

    user = User(
        full_name=payload.full_name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        provider="email",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = create_access_token(user.email)

    # Login should not fail just because the analytics timestamp could not be updated.
    try:
        user.last_login_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()

    return TokenResponse(access_token=token)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    user = db.query(User).filter(User.email == email).first()
    reset_token = None
    reset_url = None
    email_delivery_used = False
    if user and user.password_hash:
        reset_token = create_password_reset_token(user.email)
        reset_url = build_password_reset_link(reset_token)
        if password_reset_email_ready() and reset_url:
            try:
                send_password_reset_email(user.email, reset_url)
                email_delivery_used = True
            except Exception as exc:
                detail = "Could not send password reset email."
                if settings.app_env == "development":
                    detail = f"{detail} {exc}"
                raise HTTPException(status_code=500, detail=detail) from exc

    response = ForgotPasswordResponse(
        message="If that email exists, password reset instructions have been prepared.",
    )
    if settings.app_env == "development" and reset_token and not email_delivery_used:
        response.reset_token = reset_token
        response.reset_url = reset_url
    return response


@router.post("/reset-password", response_model=TokenResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        token_data = decode_password_reset_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    email = (token_data.get("sub") or "").lower()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.password_hash = hash_password(payload.new_password)
    if user.provider != "email":
        user.provider = "email"
    token = create_access_token(user.email)

    try:
        user.last_login_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()

    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
def google_sign_in(payload: OAuthRequest, db: Session = Depends(get_db)):
    try:
        email = verify_google_oauth_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = db.query(User).filter(User.email == email).first()
    if not user:
        fallback_name = email.split("@")[0].replace(".", " ").replace("_", " ").strip().title()
        user = User(
            full_name=fallback_name or None,
            email=email,
            password_hash=None,
            provider="google",
            last_login_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        try:
            user.last_login_at = datetime.now(timezone.utc)
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()

    return TokenResponse(access_token=create_access_token(user.email))


@router.post("/apple", response_model=TokenResponse)
def apple_sign_in(payload: OAuthRequest, db: Session = Depends(get_db)):
    try:
        email = verify_apple_oauth_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = db.query(User).filter(User.email == email).first()
    if not user:
        fallback_name = email.split("@")[0].replace(".", " ").replace("_", " ").strip().title()
        user = User(
            full_name=fallback_name or None,
            email=email,
            password_hash=None,
            provider="apple",
            last_login_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        try:
            user.last_login_at = datetime.now(timezone.utc)
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()

    return TokenResponse(access_token=create_access_token(user.email))
