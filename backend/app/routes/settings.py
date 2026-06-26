from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import get_current_language, get_current_user
from ..models.user import User
from ..schemas.preferences import PreferencesResponse, PreferencesUpdate
from ..services.translation_service import (
    get_available_languages,
    language_display_name,
    normalize_language_code,
    translate,
)

router = APIRouter(prefix="/api/protected/settings", tags=["settings"])


@router.get("/preferences", response_model=PreferencesResponse)
def get_preferences(
    response: Response,
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    response.headers["X-AYMO-Message"] = translate(language_code, "settings_loaded")
    return PreferencesResponse(
        aiProvider=current_user.preferred_ai_provider,
        theme=current_user.preferred_theme,
        language=language_display_name(current_user.preferred_language),
        languageCode=normalize_language_code(current_user.preferred_language),
    )


@router.put("/preferences", response_model=PreferencesResponse)
def update_preferences(
    payload: PreferencesUpdate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.aiProvider is not None:
        current_user.preferred_ai_provider = payload.aiProvider
    if payload.theme is not None:
        current_user.preferred_theme = payload.theme
    if payload.language is not None:
        current_user.preferred_language = normalize_language_code(payload.language)

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    language_code = normalize_language_code(current_user.preferred_language)
    response.headers["X-AYMO-Message"] = translate(language_code, "settings_updated")

    return PreferencesResponse(
        aiProvider=current_user.preferred_ai_provider,
        theme=current_user.preferred_theme,
        language=language_display_name(current_user.preferred_language),
        languageCode=language_code,
    )


@router.get("/languages")
def list_languages(
    response: Response,
    language_code: str = Depends(get_current_language),
):
    response.headers["X-AYMO-Message"] = translate(language_code, "languages_loaded")
    return {"languages": get_available_languages()}
