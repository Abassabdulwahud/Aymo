from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies.auth import get_current_language, get_current_user
from ..models.tag import Tag
from ..models.user import User
from ..repositories.scoped_queries import tag_for_user, tags_for_user
from ..schemas.tags import TagCreate, TagListResponse, TagResponse, TagUpdate
from ..services.translation_service import translate

router = APIRouter(prefix="/api/protected/tags", tags=["tags"])


def _tag_query(db: Session, user_id: int):
    return tags_for_user(db, user_id).options(selectinload(Tag.notes))


def _serialize_tag(tag: Tag) -> TagResponse:
    return TagResponse(
        id=tag.id,
        user_id=tag.user_id,
        name=tag.name,
        note_count=len(tag.notes),
    )


def _get_tag_or_404(db: Session, user_id: int, tag_id: int, language_code: str) -> Tag:
    tag = tag_for_user(db, user_id, tag_id).options(selectinload(Tag.notes)).first()
    if not tag:
        raise HTTPException(status_code=404, detail=translate(language_code, "tag_not_found"))
    return tag


@router.get("", response_model=TagListResponse)
def list_tags(
    search: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    query = _tag_query(db, current_user.id)
    if search.strip():
        query = query.filter(Tag.name.ilike(f"%{search.strip()}%"))

    items = query.order_by(Tag.name.asc(), Tag.id.asc()).all()
    serialized = [_serialize_tag(tag) for tag in items]
    return TagListResponse(items=serialized, total=len(serialized))


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    normalized_name = payload.name.strip()
    existing = (
        tags_for_user(db, current_user.id)
        .filter(Tag.name.ilike(normalized_name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=translate(language_code, "tag_exists"))

    tag = Tag(user_id=current_user.id, name=normalized_name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    response.headers["X-AYMO-Message"] = translate(language_code, "tag_created")
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag.id, language_code))


@router.get("/{tag_id}", response_model=TagResponse)
def get_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag_id, language_code))


@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    tag = _get_tag_or_404(db, current_user.id, tag_id, language_code)
    normalized_name = payload.name.strip()

    existing = (
        tags_for_user(db, current_user.id)
        .filter(Tag.id != tag_id)
        .filter(Tag.name.ilike(normalized_name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=translate(language_code, "tag_exists"))

    tag.name = normalized_name
    db.add(tag)
    db.commit()
    db.refresh(tag)
    response.headers["X-AYMO-Message"] = translate(language_code, "tag_updated")
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag.id, language_code))


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    tag = _get_tag_or_404(db, current_user.id, tag_id, language_code)
    db.delete(tag)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "tag_deleted")
    return response
