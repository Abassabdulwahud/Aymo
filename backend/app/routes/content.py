from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import get_current_user
from ..models.enums import FileType
from ..models.extracted_content import ExtractedContent
from ..models.file import File
from ..models.note import Note
from ..models.note_embedding import NoteEmbedding
from ..models.user import User
from ..repositories.scoped_queries import file_for_user, note_for_user
from ..services.embeddings import LONG_TEXT_CHARACTER_THRESHOLD, replace_note_embeddings
from ..schemas.ai import ContentSyncRequest, ContentSyncResponse, FileJobRequest, FileJobResponse
from ..workers.tasks import extract_pdf_task, rebuild_note_embeddings_task, scrape_link_task

router = APIRouter(prefix="/api/protected", tags=["content"])


def _get_note_or_404(db: Session, user_id: int, note_id: int) -> Note:
    note = note_for_user(db, user_id, note_id).first()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


def _get_file_or_404(db: Session, user_id: int, file_id: int) -> File:
    file_record = file_for_user(db, user_id, file_id).first()
    if file_record is None:
        raise HTTPException(status_code=404, detail="File not found.")
    return file_record


@router.post("/content/sync", response_model=ContentSyncResponse)
def sync_note_content(
    payload: ContentSyncRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, payload.note_id)
    if payload.title is not None:
        note.title = payload.title.strip()
    note.body = payload.body or ""
    note.last_synced_at = datetime.now(timezone.utc)
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
    return ContentSyncResponse(note_id=note.id, synced_at=note.last_synced_at)


@router.post("/files/extract-pdf", response_model=FileJobResponse, status_code=status.HTTP_202_ACCEPTED)
def queue_pdf_extraction(
    payload: FileJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file_record = _get_file_or_404(db, current_user.id, payload.file_id)
    if file_record.file_type != FileType.PDF:
        raise HTTPException(status_code=400, detail="Only PDF files can use this endpoint.")

    from ..models.source import Source
    from ..workers.tasks import process_source_task
    source = db.query(Source).filter(
        Source.note_id == file_record.note_id,
        Source.public_url == file_record.file_url,
    ).first()

    # Commit the "queued" state BEFORE dispatching the task.
    # If Celery runs in eager/synchronous mode the task executes inline inside
    # .delay() and writes its own completion status via _update_matching_file.
    # Committing first ensures those writes are never overwritten afterward.
    import json
    file_record.extraction_status = "queued"
    file_record.extraction_error = None
    file_record.progress_percent = 0
    file_record.detailed_steps = json.dumps([
        {"name": "Uploading & Queueing", "status": "completed"},
        {"name": "Extracting PDF Text", "status": "pending"},
        {"name": "Generating Semantic Embeddings", "status": "pending"}
    ])
    db.add(file_record)
    db.commit()

    if source:
        task = process_source_task.delay(current_user.id, source.id)
        task_id = str(task.id)
    else:
        task_id = "already-processed"

    return FileJobResponse(
        file_id=file_record.id,
        task_id=task_id,
        status="queued",
        message="PDF extraction has been queued.",
    )


@router.post("/files/transcribe-audio", response_model=FileJobResponse, status_code=status.HTTP_200_OK)
def queue_media_transcription(
    payload: FileJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file_record = _get_file_or_404(db, current_user.id, payload.file_id)
    if file_record.file_type not in {FileType.AUDIO, FileType.VIDEO}:
        raise HTTPException(status_code=400, detail="Only audio or video files can use this endpoint.")

    file_record.extraction_status = "completed"
    file_record.progress_percent = 100
    file_record.extraction_error = None
    db.add(file_record)
    db.commit()

    return FileJobResponse(
        file_id=file_record.id,
        task_id="not-applicable",
        status="completed",
        message="AI transcription is disabled. File is stored successfully.",
    )


@router.post("/files/scrape-link", response_model=FileJobResponse, status_code=status.HTTP_202_ACCEPTED)
def queue_link_scrape(
    payload: FileJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file_record = _get_file_or_404(db, current_user.id, payload.file_id)
    if file_record.file_type != FileType.LINK:
        raise HTTPException(status_code=400, detail="Only link files can use this endpoint.")

    from ..models.source import Source
    from ..workers.tasks import process_source_task
    source = db.query(Source).filter(
        Source.note_id == file_record.note_id,
        Source.public_url == file_record.file_url,
    ).first()

    if source:
        task = process_source_task.delay(current_user.id, source.id)
        task_id = str(task.id)
    else:
        task_id = "already-processed"

    file_record.extraction_status = "queued"
    file_record.extraction_error = None
    file_record.progress_percent = 0
    import json
    file_record.detailed_steps = json.dumps([
        {"name": "Uploading & Queueing", "status": "completed"},
        {"name": "Scraping Web Page", "status": "pending"},
        {"name": "Generating Semantic Embeddings", "status": "pending"}
    ])
    db.add(file_record)
    db.commit()

    return FileJobResponse(
        file_id=file_record.id,
        task_id=task_id,
        status="queued",
        message="Web page scraping has been queued.",
    )


@router.delete("/content/{content_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_extracted_content(
    content_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(ExtractedContent)
        .filter(ExtractedContent.id == content_id, ExtractedContent.user_id == current_user.id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Extracted content not found.")

    linked_file = item.file
    db.delete(item)
    if linked_file is not None:
        db.query(NoteEmbedding).filter(
            NoteEmbedding.note_id == linked_file.note_id,
            NoteEmbedding.file_id == linked_file.id,
        ).delete(synchronize_session=False)
        linked_file.extraction_status = "deleted"
        linked_file.extraction_error = "Extracted content was deleted by the user."
        db.add(linked_file)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
