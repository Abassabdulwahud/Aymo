from datetime import datetime, timezone
from ...config import get_settings
from ...models.enums import FileType
from ...models.file import File
from .base import ExtractionResult, resolve_file_for_extraction
from .documents import extract_document_content
from .images import extract_image_content
from .links import extract_link_content
from .pdfs import extract_pdf_content

settings = get_settings()


def extract_file_content(file_record: File) -> ExtractionResult:
    """
    Dispatch to the appropriate content extractor based on file type.

    Audio and video files are intentionally excluded: AI transcription is not
    yet available.  Uploading those types is still supported — they are stored
    and made accessible for playback — but this function should not be called
    for them.  If it is, an explicit error result is returned so callers fail
    cleanly instead of silently.
    """
    if file_record.file_type == FileType.LINK:
        result = extract_link_content(file_record.file_url)
    elif file_record.file_type in {FileType.PDF, FileType.DOCUMENT, FileType.IMAGE}:
        file_path, is_temp = resolve_file_for_extraction(file_record.file_url, file_record.storage_key)
        if not file_path or not file_path.exists():
            result = ExtractionResult(
                status="failed",
                content=None,
                error=f"The stored {file_record.file_type.value} file could not be found.",
            )
        else:
            try:
                if file_record.file_type == FileType.PDF:
                    result = extract_pdf_content(file_path)
                elif file_record.file_type == FileType.DOCUMENT:
                    result = extract_document_content(file_path)
                elif file_record.file_type == FileType.IMAGE:
                    result = extract_image_content(file_path, file_record.file_url)
                else:
                    result = ExtractionResult(status="failed", content=None, error="Unsupported file type.")
            finally:
                if is_temp and file_path and file_path.exists():
                    try:
                        file_path.unlink()
                    except Exception:
                        pass
    elif file_record.file_type in {FileType.AUDIO, FileType.VIDEO}:
        # AI transcription is not yet available.
        # Audio/video files are stored and playable but not extracted.
        result = ExtractionResult(
            status="skipped",
            content=None,
            error="AI transcription for this file type is not yet available.",
        )
    else:
        result = ExtractionResult(status="failed", content=None, error="Unsupported file type for extraction.")

    file_record.extracted_content = result.content
    file_record.extraction_status = result.status
    file_record.extraction_error = result.error
    file_record.extracted_at = datetime.now(timezone.utc)
    return result
