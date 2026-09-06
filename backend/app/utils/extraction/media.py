import json
import logging

from sqlalchemy.orm import object_session

from ...models.file import File
from .base import ExtractionResult

logger = logging.getLogger(__name__)


def update_file_progress(file_record: File, progress: int, status: str, error: str = None, steps: list = None) -> None:
    """Write extraction progress fields to the database."""
    db = object_session(file_record)
    if db:
        try:
            file_record.progress_percent = progress
            file_record.extraction_status = status
            if error is not None:
                file_record.extraction_error = error
            if steps is not None:
                file_record.detailed_steps = json.dumps(steps)
            db.add(file_record)
            db.commit()
            db.refresh(file_record)
        except Exception as exc:
            logger.warning("Could not write progress update to DB: %s", exc)


def process_media_file(file_path: str, file_record: File, is_video: bool) -> ExtractionResult:
    """
    Audio and video transcription is temporarily disabled.

    FFmpeg (imageio-ffmpeg), Faster-Whisper, and CTranslate2 have been removed
    to reduce Render memory usage on the 512 MB free tier.

    This function fails gracefully so the rest of the application is unaffected.
    The feature will be restored via a separate, lighter architecture in a future release.
    """
    err_msg = (
        "Audio and video transcription is temporarily disabled. "
        "This feature will be restored in a future release."
    )
    logger.info(
        "Media extraction skipped for file record %s (type=%s): %s",
        getattr(file_record, "id", "?"),
        "video" if is_video else "audio",
        err_msg,
    )
    update_file_progress(file_record, 100, "failed", error=err_msg)
    return ExtractionResult(status="failed", content=None, error=err_msg)


def extract_video_content(file_path: str, file_record: File) -> ExtractionResult:
    """Entry point for video content extraction (currently disabled)."""
    return process_media_file(file_path, file_record, is_video=True)


def extract_audio_content(file_path: str, file_record: File) -> ExtractionResult:
    """Entry point for audio content extraction (currently disabled)."""
    return process_media_file(file_path, file_record, is_video=False)
