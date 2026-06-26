from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..services.translation_service import DEFAULT_LANGUAGE_CODE, normalize_language_code, translate


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    email = getattr(request.state, "user_email", None)
    if not email:
        raise HTTPException(
            status_code=401,
            detail=translate(DEFAULT_LANGUAGE_CODE, "missing_authenticated_user"),
        )

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail=translate(DEFAULT_LANGUAGE_CODE, "user_not_found"))

    return user


def get_current_language(current_user: User = Depends(get_current_user)) -> str:
    return normalize_language_code(current_user.preferred_language)
