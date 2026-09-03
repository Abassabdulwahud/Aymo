from fastapi import APIRouter, Depends, HTTPException, status

from ..dependencies.mongo_auth import AuthenticatedUser, get_current_mongo_user
from ..mongodb import get_mongo_db
from ..repositories.mongo_repository import UserMongoRepository
from ..schemas.auth import UserResponse

router = APIRouter(prefix="/api/protected", tags=["protected"])


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: AuthenticatedUser = Depends(get_current_mongo_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )
    user_repo = UserMongoRepository(db)
    user_doc = await user_repo.get_by_id(current_user.user_id)
    if not user_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    return UserResponse(
        id=user_doc.id,
        email=user_doc.email,
        full_name=user_doc.full_name,
        preferred_ai_provider=user_doc.preferred_ai_provider,
        preferred_theme=user_doc.preferred_theme,
        preferred_language=user_doc.preferred_language,
        provider=user_doc.provider,
    )
