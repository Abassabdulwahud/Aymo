import logging
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File as FastAPIFile, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..dependencies.auth import get_current_language, get_current_user
from ..models.enums import FileType
from ..models.file import File
from ..models.user import User
from ..repositories.scoped_queries import file_for_user, files_for_user, note_for_user
from ..services.file_processing import extract_file_and_store
from ..schemas.files import FileExtractRequest, FileExtractResponse, FileListResponse, FileResponse, LinkCreate
from ..services.translation_service import translate
from ..storage import get_storage_provider
from ..utils.extraction import extract_file_content
from ..utils.storage import close_upload, detect_upload_file_type

router = APIRouter(prefix="/api/protected", tags=["files"])
settings = get_settings()
logger = logging.getLogger(__name__)


def _get_note_or_404(db: Session, user_id: int, note_id: int, language_code: str):
    note = note_for_user(db, user_id, note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail=translate(language_code, "note_not_found"))
    return note


def _get_file_or_404(db: Session, user_id: int, file_id: int, language_code: str) -> File:
    file_record = file_for_user(db, user_id, file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail=translate(language_code, "file_not_found"))
    return file_record


def _validate_link_url(url: str, language_code: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail=translate(language_code, "invalid_link"))
    return str(url)


def _delete_uploaded_asset(file_record: File) -> None:
    """Delete the physical asset for a file using the storage provider."""
    if file_record.file_type == FileType.LINK:
        return
    try:
        provider = get_storage_provider()
        provider.delete(file_record.file_url, file_record.storage_key)
    except Exception as exc:
        logger.warning(
            "Could not remove uploaded asset for file record %s: %s",
            file_record.id,
            exc,
        )


@router.get("/notes/{note_id}/files", response_model=FileListResponse)
def list_note_files(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)
    items = (
        files_for_user(db, current_user.id)
        .filter(File.note_id == note_id)
        .order_by(File.uploaded_at.desc(), File.id.desc())
        .all()
    )
    return FileListResponse(items=items, total=len(items))


def _extract_media_duration(file_path: Path) -> Optional[int]:
    import subprocess
    import re
    try:
        import imageio_ffmpeg
    except ModuleNotFoundError:
        logger.warning(
            "imageio-ffmpeg is not installed; skipping duration extraction for %s. "
            "Install it with: pip install imageio-ffmpeg",
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


@router.post("/notes/{note_id}/files", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
def upload_note_file(
    note_id: int,
    response: Response,
    upload: UploadFile = FastAPIFile(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)

    file_type = detect_upload_file_type(upload)

    provider = get_storage_provider()
    try:
        public_url, file_size = provider.upload(upload, current_user.id, note_id)
    finally:
        close_upload(upload)

    # Grab any provider-specific metadata (e.g. Cloudinary public_id)
    storage_key: Optional[str] = getattr(provider, "last_public_id", None)
    provider_name: str = settings.file_storage_provider

    # Duration extraction — only possible when the file is locally accessible
    duration_seconds = None
    if file_type in {FileType.AUDIO, FileType.VIDEO} and provider_name == "local":
        from ..utils.extraction.base import file_path_from_uploads_root
        local_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, public_url)
        if local_path and local_path.exists():
            duration_seconds = _extract_media_duration(local_path)

    file_record = File(
        note_id=note_id,
        user_id=current_user.id,
        file_name=upload.filename or "upload",
        file_type=file_type,
        file_url=public_url,
        file_size=file_size,
        duration_seconds=duration_seconds,
        storage_provider=provider_name,
        storage_key=storage_key,
        cdn_url=public_url if provider_name == "cloudinary" else None,
    )
    db.add(file_record)
    db.commit()
    db.refresh(file_record)

    # --- Dual-write: create a matching Source row for every new File ---
    try:
        from ..models.source import Source
        from ..models.enums import SourceType, SourceStatus

        source_type_map = {
            FileType.PDF: SourceType.PDF,
            FileType.VIDEO: SourceType.VIDEO,
            FileType.AUDIO: SourceType.AUDIO,
            FileType.DOCUMENT: SourceType.DOCUMENT,
            FileType.LINK: SourceType.LINK,
            FileType.IMAGE: SourceType.IMAGE,
        }
        source_type = source_type_map.get(file_type, SourceType.DOCUMENT)

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
            storage_provider=provider_name,
            storage_key=storage_key,
            cdn_url=public_url if provider_name == "cloudinary" else None,
        )
        db.add(source_record)
        db.commit()
        db.refresh(source_record)

        # Auto-queue the source for processing
        from ..workers.tasks import process_source_task
        # ── DIAGNOSTIC ONLY ── bypass Celery queue, run synchronously in the web process.
        # If processing succeeds here, the root cause is a missing/broken Celery worker.
        # Revert this line back to  process_source_task.delay(...)  after diagnosis.
        process_source_task.apply(args=[current_user.id, source_record.id])
    except Exception as exc:
        # Dual-write is best-effort — never block the original File upload
        logger.warning("Failed to dual-write Source for file %d: %s", file_record.id, exc)

    response.headers["X-AYMO-Message"] = translate(language_code, "file_uploaded")
    return file_record


@router.post("/notes/{note_id}/links", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
def create_note_link(
    note_id: int,
    payload: LinkCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    _get_note_or_404(db, current_user.id, note_id, language_code)
    normalized_url = _validate_link_url(str(payload.url), language_code)

    file_record = File(
        note_id=note_id,
        user_id=current_user.id,
        file_name=(payload.title or normalized_url).strip(),
        file_type=FileType.LINK,
        file_url=normalized_url,
        file_size=0,
    )
    db.add(file_record)
    db.commit()
    db.refresh(file_record)

    # --- Dual-write: create a matching Source row for every new Link ---
    try:
        from ..models.source import Source
        from ..models.enums import SourceType, SourceStatus

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

        # Auto-queue the source for processing
        from ..workers.tasks import process_source_task
        process_source_task.delay(current_user.id, source_record.id)
    except Exception as exc:
        logger.warning("Failed to dual-write Source for link %d: %s", file_record.id, exc)

    response.headers["X-AYMO-Message"] = translate(language_code, "file_uploaded")
    return file_record


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    file_record = _get_file_or_404(db, current_user.id, file_id, language_code)
    _delete_uploaded_asset(file_record)

    # Also delete matching Source record if it exists
    from ..models.source import Source
    try:
        db.query(Source).filter(
            Source.note_id == file_record.note_id,
            Source.public_url == file_record.file_url,
        ).delete(synchronize_session=False)
    except Exception as exc:
        logger.warning("Failed to delete matching Source for file %d: %s", file_record.id, exc)

    file_for_user(db, current_user.id, file_id).delete(synchronize_session=False)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers["X-AYMO-Message"] = translate(language_code, "file_deleted")
    return response


@router.post("/files/extract", response_model=FileExtractResponse)
def extract_file(
    payload: FileExtractRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    language_code: str = Depends(get_current_language),
):
    file_record = _get_file_or_404(db, current_user.id, payload.file_id, language_code)
    message = translate(language_code, "file_extract_success")
    try:
        extract_file_and_store(db, file_record)
        db.commit()
        db.refresh(file_record)
    except Exception as exc:
        db.rollback()
        result = extract_file_content(file_record)
        db.add(file_record)
        db.commit()
        db.refresh(file_record)
        message = result.error or str(exc) or translate(language_code, "file_extract_warning")
        response.headers["X-AYMO-Warning"] = message
        return FileExtractResponse(item=file_record, message=message)

    return FileExtractResponse(item=file_record, message=message)
