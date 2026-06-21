from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies.auth import get_current_user
from ..models.note import Note
from ..models.tag import Tag
from ..models.user import User
from ..repositories.scoped_queries import note_for_user, notes_for_user, tags_for_user
from ..schemas.notes import NoteCreate, NoteListResponse, NoteResponse, NoteStateUpdate, NoteUpdate

router = APIRouter(prefix="/api/protected/notes", tags=["notes"])


def _note_query(db: Session, user_id: int):
    return notes_for_user(db, user_id).options(
        selectinload(Note.tags),
        selectinload(Note.files),
    )


def _get_note_or_404(db: Session, user_id: int, note_id: int) -> Note:
    note = (
        note_for_user(db, user_id, note_id)
        .options(selectinload(Note.tags), selectinload(Note.files))
        .first()
    )
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


def _resolve_tags(db: Session, user_id: int, tag_ids: List[int]) -> List[Tag]:
    if not tag_ids:
        return []

    tags = tags_for_user(db, user_id).filter(Tag.id.in_(tag_ids)).all()
    if len(tags) != len(set(tag_ids)):
        raise HTTPException(status_code=404, detail="One or more tags were not found for this user.")
    return tags


@router.get("", response_model=NoteListResponse)
def list_notes(
    search: Optional[str] = Query(default=None),
    pinned: Optional[bool] = Query(default=None),
    favorited: Optional[bool] = Query(default=None),
    tag_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = _note_query(db, current_user.id)

    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter((Note.title.ilike(search_term)) | (Note.body.ilike(search_term)))
    if pinned is not None:
        query = query.filter(Note.is_pinned == pinned)
    if favorited is not None:
        query = query.filter(Note.is_favorited == favorited)
    if tag_id is not None:
        query = query.join(Note.tags).filter(Tag.id == tag_id, Tag.user_id == current_user.id)

    items = query.order_by(Note.updated_at.desc(), Note.id.desc()).all()
    return NoteListResponse(items=items, total=len(items))


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = Note(
        user_id=current_user.id,
        title=payload.title.strip(),
        body=payload.body,
        is_pinned=payload.is_pinned,
        is_favorited=payload.is_favorited,
    )
    note.tags = _resolve_tags(db, current_user.id, payload.tag_ids)

    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id)


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_note_or_404(db, current_user.id, note_id)


@router.patch("/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, note_id)
    data = payload.model_dump(exclude_unset=True)

    if "title" in data:
        note.title = (data["title"] or "").strip()
    if "body" in data:
        note.body = data["body"] or ""
    if "is_pinned" in data:
        note.is_pinned = data["is_pinned"]
    if "is_favorited" in data:
        note.is_favorited = data["is_favorited"]
    if "tag_ids" in data:
        note.tags = _resolve_tags(db, current_user.id, data["tag_ids"] or [])

    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id)


@router.post("/{note_id}/pin", response_model=NoteResponse)
def set_note_pin_state(
    note_id: int,
    payload: NoteStateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, note_id)
    note.is_pinned = payload.value
    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id)


@router.post("/{note_id}/favorite", response_model=NoteResponse)
def set_note_favorite_state(
    note_id: int,
    payload: NoteStateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, note_id)
    note.is_favorited = payload.value
    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, note_id)
    db.delete(note)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
