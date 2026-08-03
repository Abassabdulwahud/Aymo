from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import get_current_user
from ..models.annotation import Annotation
from ..models.user import User
from ..schemas.annotations import (
    AnnotationCreate,
    AnnotationListResponse,
    AnnotationRead,
    AnnotationUpdate,
)

router = APIRouter(prefix="/api/protected/annotations", tags=["annotations"])


# ── helpers ────────────────────────────────────────────────────────────────────

def _get_annotation_or_404(db: Session, user_id: int, annotation_id: int) -> Annotation:
    annotation = (
        db.query(Annotation)
        .filter(Annotation.id == annotation_id, Annotation.user_id == user_id)
        .first()
    )
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    return annotation


# ── list ───────────────────────────────────────────────────────────────────────

@router.get("", response_model=AnnotationListResponse)
def list_annotations(
    source_type: str = Query(...),
    source_id: int = Query(...),
    page_number: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all annotations for a given document (filtered by source_type + source_id)."""
    query = db.query(Annotation).filter(
        Annotation.user_id == current_user.id,
        Annotation.source_type == source_type,
        Annotation.source_id == source_id,
    )
    if page_number is not None:
        query = query.filter(Annotation.page_number == page_number)

    items = query.order_by(Annotation.page_number.asc(), Annotation.created_at.asc()).all()
    return AnnotationListResponse(items=items, total=len(items))


# ── create ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=AnnotationRead, status_code=201)
def create_annotation(
    payload: AnnotationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    annotation = Annotation(
        user_id=current_user.id,
        source_type=payload.source_type,
        source_id=payload.source_id,
        page_number=payload.page_number,
        selected_text=payload.selected_text,
        bounding_rects=payload.bounding_rects,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        color=payload.color,
        annotation_type=payload.annotation_type,
        comment=payload.comment,
        linked_note_id=payload.linked_note_id,
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return annotation


# ── update ─────────────────────────────────────────────────────────────────────

@router.patch("/{annotation_id}", response_model=AnnotationRead)
def update_annotation(
    annotation_id: int,
    payload: AnnotationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    annotation = _get_annotation_or_404(db, current_user.id, annotation_id)
    if payload.color is not None:
        annotation.color = payload.color
    if payload.annotation_type is not None:
        annotation.annotation_type = payload.annotation_type
    if payload.comment is not None:
        annotation.comment = payload.comment
    if payload.linked_note_id is not None:
        annotation.linked_note_id = payload.linked_note_id
    db.commit()
    db.refresh(annotation)
    return annotation


# ── delete ─────────────────────────────────────────────────────────────────────

@router.delete("/{annotation_id}", status_code=204)
def delete_annotation(
    annotation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    annotation = _get_annotation_or_404(db, current_user.id, annotation_id)
    db.delete(annotation)
    db.commit()
