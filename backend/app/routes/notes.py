from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies.auth import get_current_language, get_current_user
from ..models.note import Note
from ..models.tag import Tag
from ..models.user import User
from ..repositories.scoped_queries import note_for_user, notes_for_user, tags_for_user
from ..schemas.notes import NoteCreate, NoteListResponse, NoteResponse, NoteStateUpdate, NoteUpdate
from ..services.embeddings import LONG_TEXT_CHARACTER_THRESHOLD, replace_note_embeddings
from ..services.translation_service import translate
from .files import _delete_uploaded_asset
from ..workers.tasks import rebuild_note_embeddings_task

router = APIRouter(prefix="/api/protected/notes", tags=["notes"])


def _note_query(db: Session, user_id: int):
    return notes_for_user(db, user_id).options(
        selectinload(Note.tags),
        selectinload(Note.files),
    )


def _get_note_or_404(db: Session, user_id: int, note_id: int, language_code: str) -> Note:
    note = (
        note_for_user(db, user_id, note_id)
        .options(selectinload(Note.tags), selectinload(Note.files))
        .first()
    )
    if not note:
        raise HTTPException(status_code=404, detail=translate(language_code, "note_not_found"))
    return note


def _resolve_tags(db: Session, user_id: int, tag_ids: List[int], language_code: str) -> List[Tag]:
    if not tag_ids:
        return []

    tags = tags_for_user(db, user_id).filter(Tag.id.in_(tag_ids)).all()
    if len(tags) != len(set(tag_ids)):
        raise HTTPException(status_code=404, detail=translate(language_code, "tags_not_found"))
    return tags


@router.get("", response_model=NoteListResponse)
def list_notes(
    search: Optional[str] = Query(default=None),
    pinned: Optional[bool] = Query(default=None),
    favorited: Optional[bool] = Query(default=None),
    tag_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
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
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    note = Note(
        user_id=current_user.id,
        title=payload.title.strip(),
        body=payload.body,
        is_pinned=payload.is_pinned,
        is_favorited=payload.is_favorited,
        last_synced_at=datetime.now(timezone.utc),
    )
    note.tags = _resolve_tags(db, current_user.id, payload.tag_ids, language_code)

    db.add(note)
    db.commit()
    db.refresh(note)
    note_embedding_source = "{0}\n\n{1}".format(note.title or "", note.body or "").strip()
    embedding_warning = replace_note_embeddings(db, note.id, note_embedding_source)
    db.commit()
    if embedding_warning:
        response.headers["X-AYMO-Warning"] = embedding_warning
    response.headers["X-AYMO-Message"] = translate(language_code, "note_created")
    return _get_note_or_404(db, current_user.id, note.id, language_code)


# --- Trash Router Endpoints (MUST be registered before /{note_id} so "trash" is not parsed as an int) ---

@router.get("/trash", response_model=NoteListResponse)
def list_trashed_notes(
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    from ..repositories.scoped_queries import trashed_notes_for_user
    query = trashed_notes_for_user(db, current_user.id).options(
        selectinload(Note.tags),
        selectinload(Note.files),
    )
    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter((Note.title.ilike(search_term)) | (Note.body.ilike(search_term)))
    items = query.order_by(Note.deleted_at.desc(), Note.id.desc()).all()
    return NoteListResponse(items=items, total=len(items))


@router.post("/trash/{note_id}/restore", response_model=NoteResponse)
def restore_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    from ..repositories.scoped_queries import trashed_note_for_user
    note = trashed_note_for_user(db, current_user.id, note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail=translate(language_code, "note_not_found"))
    note.deleted_at = None
    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id, language_code)


@router.delete("/trash/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def permanently_delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    from ..repositories.scoped_queries import trashed_note_for_user
    note = (
        trashed_note_for_user(db, current_user.id, note_id)
        .options(selectinload(Note.files))
        .first()
    )
    if not note:
        raise HTTPException(status_code=404, detail=translate(language_code, "note_not_found"))

    for file_record in note.files:
        _delete_uploaded_asset(file_record)
        from ..models.source import Source
        try:
            db.query(Source).filter(
                Source.note_id == file_record.note_id,
                Source.public_url == file_record.file_url,
            ).delete(synchronize_session=False)
        except Exception:
            pass

    db.delete(note)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "note_deleted_permanently")
    return response


@router.delete("/trash", status_code=status.HTTP_204_NO_CONTENT)
def empty_trash(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    from ..repositories.scoped_queries import trashed_notes_for_user
    notes = (
        trashed_notes_for_user(db, current_user.id)
        .options(selectinload(Note.files))
        .all()
    )
    for note in notes:
        for file_record in note.files:
            _delete_uploaded_asset(file_record)
            from ..models.source import Source
            try:
                db.query(Source).filter(
                    Source.note_id == file_record.note_id,
                    Source.public_url == file_record.file_url,
                ).delete(synchronize_session=False)
            except Exception:
                pass
        db.delete(note)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "trash_emptied")
    return response


# --- Per-note CRUD (must come AFTER literal-path routes like /trash) ---

@router.get("/{note_id}", response_model=NoteResponse)
def get_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    return _get_note_or_404(db, current_user.id, note_id, language_code)


@router.patch("/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    note = _get_note_or_404(db, current_user.id, note_id, language_code)
    data = payload.model_dump(exclude_unset=True)
    embedding_warning = None

    if "title" in data:
        note.title = (data["title"] or "").strip()
    if "body" in data:
        note.body = data["body"] or ""
    if "is_pinned" in data:
        note.is_pinned = data["is_pinned"]
    if "is_favorited" in data:
        note.is_favorited = data["is_favorited"]
    if "tag_ids" in data:
        note.tags = _resolve_tags(db, current_user.id, data["tag_ids"] or [], language_code)

    db.add(note)
    db.commit()
    db.refresh(note)

    note_embedding_source = "{0}\n\n{1}".format(note.title or "", note.body or "").strip()
    if len(note_embedding_source) > LONG_TEXT_CHARACTER_THRESHOLD:
        rebuild_note_embeddings_task.delay(note.id, None, note_embedding_source)
    else:
        embedding_warning = replace_note_embeddings(db, note.id, note_embedding_source)
        db.commit()

    if embedding_warning:
        response.headers["X-AYMO-Warning"] = embedding_warning
    response.headers["X-AYMO-Message"] = translate(language_code, "note_updated")
    return _get_note_or_404(db, current_user.id, note.id, language_code)


@router.post("/{note_id}/pin", response_model=NoteResponse)
def set_note_pin_state(
    note_id: int,
    payload: NoteStateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    note = _get_note_or_404(db, current_user.id, note_id, language_code)
    note.is_pinned = payload.value
    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id, language_code)


@router.post("/{note_id}/favorite", response_model=NoteResponse)
def set_note_favorite_state(
    note_id: int,
    payload: NoteStateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    note = _get_note_or_404(db, current_user.id, note_id, language_code)
    note.is_favorited = payload.value
    db.add(note)
    db.commit()
    db.refresh(note)
    return _get_note_or_404(db, current_user.id, note.id, language_code)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    note = _get_note_or_404(db, current_user.id, note_id, language_code)
    note.deleted_at = datetime.now(timezone.utc)
    db.add(note)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "note_deleted")
    return response
