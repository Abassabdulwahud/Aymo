import logging
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File as FastAPIFile, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..dependencies.auth import get_current_language, get_current_user
from ..models.enums import SourceType, SourceStatus
from ..models.source import Source
from ..models.source_chunk import SourceChunk
from ..models.source_summary import SourceSummary
from ..models.note import Note
from ..models.user import User
from ..repositories.scoped_queries import note_for_user
from ..schemas.files import LinkCreate
from ..schemas.sources import (
    SourceResponse,
    SourceListResponse,
    SourceStatusResponse,
    SourceTranscriptResponse,
    SourceSummaryResponse,
    SourceProcessRequest,
)
from ..services.translation_service import translate
from ..utils.storage import close_upload, detect_upload_file_type, save_upload_file
from ..utils.extraction.base import file_path_from_uploads_root

router = APIRouter(prefix="/api/protected", tags=["sources"])
settings = get_settings()
logger = logging.getLogger(__name__)


def _get_note_or_404(db: Session, user_id: int, note_id: int, language_code: str) -> Note:
    note = note_for_user(db, user_id, note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail=translate(language_code, "note_not_found"))
    return note


def _get_source_or_404(db: Session, user_id: int, source_id: int, language_code: str) -> Source:
    source = db.query(Source).filter(Source.id == source_id, Source.user_id == user_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found.")
    return source


def _validate_link_url(url: str, language_code: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail=translate(language_code, "invalid_link"))
    return str(url)


def _delete_source_asset(public_url: Optional[str]) -> None:
    if not public_url or not public_url.startswith(settings.uploads_base_url):
        return

    relative_parts = [part for part in public_url[len(settings.uploads_base_url):].split("/") if part]
    file_path = Path(settings.uploads_dir).resolve().joinpath(*relative_parts)
    if not file_path.exists():
        return

    try:
        file_path.unlink()
    except OSError as exc:
        logger.warning(
            "Could not remove uploaded file '%s': %s",
            file_path,
            exc,
        )


def _extract_media_duration(file_path: Path) -> Optional[int]:
    import subprocess
    import re
    try:
        import imageio_ffmpeg
    except ModuleNotFoundError:
        logger.warning(
            "imageio-ffmpeg is not installed; skipping duration extraction for %s",
            file_path,
        )
        return None
    try:
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        result = subprocess.run(
            [ffmpeg_exe, "-i", str(file_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10
        )
        match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2})", result.stderr)
        if match:
            hours, minutes, seconds = map(int, match.groups())
            return hours * 3600 + minutes * 60 + seconds
    except Exception as exc:
        logger.warning("Failed to extract media duration for %s: %s", file_path, exc)
    return None


@router.get("/notes/{note_id}/sources", response_model=SourceListResponse)
def list_note_sources(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)
    items = (
        db.query(Source)
        .filter(Source.note_id == note_id, Source.user_id == current_user.id)
        .order_by(Source.created_at.desc(), Source.id.desc())
        .all()
    )
    return SourceListResponse(items=items, total=len(items))


@router.post("/notes/{note_id}/sources", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def upload_note_source(
    note_id: int,
    response: Response,
    upload: UploadFile = FastAPIFile(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)

    file_type = detect_upload_file_type(upload)
    try:
        source_type = SourceType[file_type.name]
    except KeyError:
        source_type = SourceType.DOCUMENT

    try:
        public_url, file_size = save_upload_file(upload, current_user.id, note_id)
    finally:
        close_upload(upload)

    duration_seconds = None
    if source_type in {SourceType.AUDIO, SourceType.VIDEO}:
        local_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, public_url)
        if local_path and local_path.exists():
            duration_seconds = _extract_media_duration(local_path)

    source_record = Source(
        note_id=note_id,
        user_id=current_user.id,
        source_type=source_type,
        title=upload.filename or "upload",
        original_filename=upload.filename,
        file_size=file_size,
        duration_seconds=duration_seconds,
        mime_type=upload.content_type,
        public_url=public_url,
        status=SourceStatus.UPLOADED,
    )
    db.add(source_record)
    db.commit()
    db.refresh(source_record)
    
    # Auto-trigger Celery processing task
    from ..workers.tasks import process_source_task
    process_source_task.delay(current_user.id, source_record.id)

    response.headers["X-AYMO-Message"] = translate(language_code, "file_uploaded")
    return source_record


@router.post("/notes/{note_id}/sources/links", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def create_link_source(
    note_id: int,
    payload: LinkCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)
    normalized_url = _validate_link_url(str(payload.url), language_code)

    source_record = Source(
        note_id=note_id,
        user_id=current_user.id,
        source_type=SourceType.LINK,
        title=(payload.title or normalized_url).strip(),
        original_filename=None,
        file_size=0,
        public_url=normalized_url,
        status=SourceStatus.UPLOADED,
    )
    db.add(source_record)
    db.commit()
    db.refresh(source_record)
    
    # Auto-trigger Celery processing task
    from ..workers.tasks import process_source_task
    process_source_task.delay(current_user.id, source_record.id)

    response.headers["X-AYMO-Message"] = translate(language_code, "file_uploaded")
    return source_record


@router.get("/sources/{id}", response_model=SourceResponse)
def get_source_detail(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    return _get_source_or_404(db, current_user.id, id, language_code)


@router.get("/sources/{id}/status", response_model=SourceStatusResponse)
def get_source_status(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    return _get_source_or_404(db, current_user.id, id, language_code)


@router.get("/sources/{id}/transcript", response_model=SourceTranscriptResponse)
def get_source_transcript(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    source = _get_source_or_404(db, current_user.id, id, language_code)
    chunks = (
        db.query(SourceChunk)
        .filter(SourceChunk.source_id == source.id)
        .order_by(SourceChunk.chunk_index.asc())
        .all()
    )
    return SourceTranscriptResponse(items=chunks, total=len(chunks))


@router.get("/sources/{id}/summary", response_model=SourceSummaryResponse)
def get_source_summary(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    source = _get_source_or_404(db, current_user.id, id, language_code)
    summary = (
        db.query(SourceSummary)
        .filter(SourceSummary.source_id == source.id, SourceSummary.user_id == current_user.id)
        .order_by(SourceSummary.created_at.desc())
        .first()
    )
    
    if not summary:
        # If no summary exists yet and the source status is ready, generate it on demand
        if source.status == SourceStatus.READY:
            from ..services.source_summary import summarize_source
            summary = summarize_source(db, source)
            db.commit()
        else:
            raise HTTPException(status_code=404, detail="Summary not ready or not found.")
            
    return summary


@router.post("/sources/{id}/process", response_model=SourceResponse)
def process_source(
    id: int,
    payload: SourceProcessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    source = _get_source_or_404(db, current_user.id, id, language_code)
    
    # If forced or failed, we clear previous progress/error/chunks and start over
    if payload.force or source.status == SourceStatus.FAILED:
        source.status = SourceStatus.UPLOADED
        source.processing_progress = 0
        source.processing_error = None
        source.summary = None
        source.keywords = None
        
        # Reset adapter progress fields in cache
        from ..services.cache import cache_client
        cache_client.set_json(f"source:{source.id}:processed_chunks", {"value": 0}, 1)
        cache_client.set_json(f"source:{source.id}:total_chunks", {"value": 0}, 1)
        cache_client.set_json(f"source:{source.id}:detailed_steps", {"value": None}, 1)
        cache_client.set_json(f"source:{source.id}:partial_transcript", {"value": None}, 1)
        
        # Clear database chunks, summaries, and embeddings
        db.query(SourceChunk).filter(SourceChunk.source_id == source.id).delete()
        db.query(SourceSummary).filter(SourceSummary.source_id == source.id).delete()
        from ..models.note_embedding import NoteEmbedding
        db.query(NoteEmbedding).filter(NoteEmbedding.source_id == source.id).delete()
        
        db.add(source)
        db.commit()

    from ..workers.tasks import process_source_task
    process_source_task.delay(current_user.id, source.id)
    
    db.refresh(source)
    return source


@router.post("/sources/{id}/resume", response_model=SourceResponse)
def resume_source(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    source = _get_source_or_404(db, current_user.id, id, language_code)
    
    if source.status != SourceStatus.FAILED:
        # Only allow resuming if it was failed/partial
        raise HTTPException(
            status_code=400,
            detail=f"Source is currently in {source.status.value} state, cannot resume."
        )

    from ..workers.tasks import process_source_task
    process_source_task.delay(current_user.id, source.id)
    
    return source


@router.delete("/sources/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    source = _get_source_or_404(db, current_user.id, id, language_code)
    
    # 1. Delete physical upload asset if it exists
    _delete_source_asset(source.public_url)
    
    # 2. Delete database record (cascading deletes for chunks, summaries, note_embeddings)
    db.delete(source)
    db.commit()
    
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "file_deleted")
    return response
