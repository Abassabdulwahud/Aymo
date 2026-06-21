from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies.auth import get_current_user
from ..models.tag import Tag
from ..models.user import User
from ..repositories.scoped_queries import tag_for_user, tags_for_user
from ..schemas.tags import TagCreate, TagListResponse, TagResponse, TagUpdate

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


def _get_tag_or_404(db: Session, user_id: int, tag_id: int) -> Tag:
    tag = tag_for_user(db, user_id, tag_id).options(selectinload(Tag.notes)).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    return tag


@router.get("", response_model=TagListResponse)
def list_tags(
    search: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_name = payload.name.strip()
    existing = (
        tags_for_user(db, current_user.id)
        .filter(Tag.name.ilike(normalized_name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists for this user.")

    tag = Tag(user_id=current_user.id, name=normalized_name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag.id))


@router.get("/{tag_id}", response_model=TagResponse)
def get_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag_id))


@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: int,
    payload: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = _get_tag_or_404(db, current_user.id, tag_id)
    normalized_name = payload.name.strip()

    existing = (
        tags_for_user(db, current_user.id)
        .filter(Tag.id != tag_id)
        .filter(Tag.name.ilike(normalized_name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists for this user.")

    tag.name = normalized_name
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _serialize_tag(_get_tag_or_404(db, current_user.id, tag.id))


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = _get_tag_or_404(db, current_user.id, tag_id)
    db.delete(tag)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
