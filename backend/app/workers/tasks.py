import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.enums import FileType
from ..models.file import File
from ..services.content_store import upsert_extracted_content
from ..services.embeddings import replace_note_embeddings
from ..services.file_processing import extract_file_and_store, get_file_or_none, store_media_transcript
from ..utils.extraction.links import extract_link_content
from .celery_app import celery_app

logger = logging.getLogger(__name__)


def _update_file_failure(db: Session, file_record: File, message: str) -> None:
    file_record.extraction_status = "failed"
    file_record.extraction_error = message
    file_record.extracted_at = datetime.now(timezone.utc)
    db.add(file_record)
    db.commit()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.tasks.extract_pdf_task",
)
def extract_pdf_task(self, user_id: int, file_id: int):
    db = SessionLocal()
    try:
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is None:
            return {"status": "missing"}
        file_record.extraction_status = "processing"
        db.add(file_record)
        db.commit()

        content = extract_file_and_store(db, file_record)
        db.commit()
        return {"status": "completed", "file_id": file_id, "length": len(content)}
    except Exception as exc:
        db.rollback()
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is not None:
            _update_file_failure(db, file_record, str(exc))
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.tasks.scrape_link_task",
)
def scrape_link_task(self, user_id: int, file_id: int):
    db = SessionLocal()
    try:
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is None:
            return {"status": "missing"}
        file_record.extraction_status = "processing"
        db.add(file_record)
        db.commit()

        result = extract_link_content(file_record.file_url)
        if result.status != "completed" or not result.content:
            raise RuntimeError(result.error or "Could not scrape the link content.")

        upsert_extracted_content(
            db=db,
            note=file_record.note,
            user_id=file_record.user_id,
            source_type="link_text",
            source_label=file_record.file_name,
            content_text=result.content,
            file_record=file_record,
            source_url=file_record.file_url,
        )
        file_record.extraction_status = "completed"
        file_record.extraction_error = None
        file_record.extracted_at = datetime.now(timezone.utc)
        file_record.extracted_content = None
        db.add(file_record)
        db.commit()
        return {"status": "completed", "file_id": file_id, "length": len(result.content)}
    except Exception as exc:
        db.rollback()
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is not None:
            _update_file_failure(db, file_record, str(exc))
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.tasks.transcribe_media_task",
)
def transcribe_media_task(
    self,
    user_id: int,
    file_id: int,
    transcript_text: Optional[str] = None,
    duration_seconds: Optional[int] = None,
):
    db = SessionLocal()
    try:
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is None:
            return {"status": "missing"}

        if file_record.file_type not in {FileType.AUDIO, FileType.VIDEO}:
            raise RuntimeError("Only audio and video files can be transcribed.")

        file_record.extraction_status = "processing"
        if duration_seconds is not None:
            file_record.duration_seconds = duration_seconds
        db.add(file_record)
        db.commit()

        if not transcript_text:
            # Perform server-side transcription and OCR pipeline
            content_text = extract_file_and_store(db, file_record)
            db.commit()
            return {
                "status": "completed",
                "file_id": file_id,
                "length": len(content_text),
                "cached": False,
            }

        content_text, from_cache = store_media_transcript(db, file_record, transcript_text, duration_seconds)
        db.commit()
        return {
            "status": "completed",
            "file_id": file_id,
            "length": len(content_text),
            "cached": from_cache,
        }
    except Exception as exc:
        db.rollback()
        file_record = get_file_or_none(db, user_id, file_id)
        if file_record is not None:
            _update_file_failure(db, file_record, str(exc))
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.tasks.rebuild_note_embeddings_task",
)
def rebuild_note_embeddings_task(
    self,
    note_id: int,
    file_id: Optional[int] = None,
    content_text: str = "",
):
    db = SessionLocal()
    try:
        warning = replace_note_embeddings(db, note_id=note_id, file_id=file_id, content_text=content_text)
        db.commit()
        return {"status": "completed", "note_id": note_id, "file_id": file_id, "warning": warning}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _mark_source_failed(source_id: int, user_id: int, error_message: str) -> None:
    """
    Mark a Source as FAILED in the DB and sync the error to the matching File record.
    Called from the Celery failure hook to handle worker-process crashes (OOM/SIGKILL)
    that leave the Source stuck at QUEUED because the normal except block never ran.
    """
    from ..models.source import Source
    from ..models.enums import SourceStatus
    from ..models.file import File

    db = SessionLocal()
    try:
        source = db.query(Source).filter(Source.id == source_id, Source.user_id == user_id).first()
        if source is None:
            return
        # Only overwrite if still stuck in a transient state
        if source.status not in (SourceStatus.READY, SourceStatus.FAILED):
            source.status = SourceStatus.FAILED
            source.processing_error = error_message
            source.processing_progress = 100
            db.add(source)

            file_record = db.query(File).filter(
                File.note_id == source.note_id,
                File.file_url == source.public_url,
            ).first()
            if file_record and file_record.extraction_status not in ("completed", "failed"):
                file_record.extraction_status = "failed"
                file_record.progress_percent = 100
                file_record.extraction_error = error_message
                db.add(file_record)

            db.commit()
            logger.error(
                "process_source_task permanently failed for source %d (user %d): %s",
                source_id, user_id, error_message,
            )
    except Exception as inner_exc:
        logger.error("_mark_source_failed also failed for source %d: %s", source_id, inner_exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    acks_late=True,          # Don't ack until task finishes — prevents task loss on SIGKILL
    name="app.workers.tasks.process_source_task",
)
def process_source_task(self, user_id: int, source_id: int):
    from ..models.source import Source
    from ..models.enums import SourceStatus
    from ..services.processors.registry import get_processor

    db = SessionLocal()
    try:
        source = db.query(Source).filter(Source.id == source_id, Source.user_id == user_id).first()
        if source is None:
            return {"status": "missing"}

        source.status = SourceStatus.QUEUED
        db.add(source)
        db.commit()

        # Get processor
        processor = get_processor(source.source_type)
        processor.process(source, db)

        return {"status": "completed", "source_id": source_id}
    except Exception as exc:
        db.rollback()
        # Check if this is the FINAL retry — if so, permanently mark as FAILED
        if self.request.retries >= self.max_retries:
            _mark_source_failed(source_id, user_id, str(exc))
        else:
            # Transient failure — still update to FAILED so UI shows error immediately,
            # but allow Celery to retry the task
            try:
                source = db.query(Source).filter(Source.id == source_id, Source.user_id == user_id).first()
                if source is not None:
                    source.status = SourceStatus.FAILED
                    source.processing_error = str(exc)
                    source.processing_progress = 100
                    db.add(source)

                    from ..models.file import File
                    file_record = db.query(File).filter(
                        File.note_id == source.note_id,
                        File.file_url == source.public_url
                    ).first()
                    if file_record:
                        file_record.extraction_status = "failed"
                        file_record.progress_percent = 100
                        file_record.extraction_error = str(exc)
                        db.add(file_record)

                    db.commit()
            except Exception as sync_exc:
                logger.error("Failed to sync FAILED state for source %d: %s", source_id, sync_exc)
                try:
                    db.rollback()
                except Exception:
                    pass
        raise
    finally:
        db.close()


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    name="app.workers.tasks.generate_source_summary_task",
)
def generate_source_summary_task(self, user_id: int, source_id: int):
    from ..models.source import Source
    from ..services.source_summary import summarize_source

    db = SessionLocal()
    try:
        source = db.query(Source).filter(Source.id == source_id, Source.user_id == user_id).first()
        if source is None:
            return {"status": "missing"}

        summarize_source(db, source)
        db.commit()
        return {"status": "completed", "source_id": source_id}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

