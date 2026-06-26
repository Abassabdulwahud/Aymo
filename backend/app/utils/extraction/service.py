from datetime import datetime, timezone

from ...config import get_settings
from ...models.enums import FileType
from ...models.file import File
from .base import ExtractionResult, file_path_from_uploads_root
from .documents import extract_document_content
from .images import extract_image_content
from .links import extract_link_content
from .media import extract_audio_content, extract_video_content
from .pdfs import extract_pdf_content

settings = get_settings()


def extract_file_content(file_record: File) -> ExtractionResult:
    if file_record.file_type == FileType.LINK:
        result = extract_link_content(file_record.file_url)
    elif file_record.file_type == FileType.PDF:
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error="The stored PDF file could not be found.")
        else:
            result = extract_pdf_content(file_path)
    elif file_record.file_type == FileType.DOCUMENT:
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error="The stored document file could not be found.")
        else:
            result = extract_document_content(file_path)
    elif file_record.file_type == FileType.IMAGE:
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error="The stored image file could not be found.")
        else:
            result = extract_image_content(file_path, file_record.file_url)
    elif file_record.file_type == FileType.VIDEO:
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error="The stored video file could not be found.")
        else:
            result = extract_video_content(str(file_path), file_record)
    elif file_record.file_type == FileType.AUDIO:
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error="The stored audio file could not be found.")
        else:
            result = extract_audio_content(str(file_path), file_record)
    else:
        result = ExtractionResult(status="failed", content=None, error="Unsupported file type for extraction.")

    file_record.extracted_content = result.content
    file_record.extraction_status = result.status
    file_record.extraction_error = result.error
    file_record.extracted_at = datetime.now(timezone.utc)
    return result
