from datetime import datetime, timezone
from ...config import get_settings
from ...models.enums import FileType
from ...models.file import File
from .base import ExtractionResult, resolve_file_for_extraction
from .documents import extract_document_content
from .images import extract_image_content
from .links import extract_link_content
from .media import extract_audio_content, extract_video_content
from .pdfs import extract_pdf_content

settings = get_settings()


def extract_file_content(file_record: File) -> ExtractionResult:
    if file_record.file_type == FileType.LINK:
        result = extract_link_content(file_record.file_url)
    elif file_record.file_type in {FileType.PDF, FileType.DOCUMENT, FileType.IMAGE, FileType.VIDEO, FileType.AUDIO}:
        file_path, is_temp = resolve_file_for_extraction(file_record.file_url, file_record.storage_key)
        if not file_path or not file_path.exists():
            result = ExtractionResult(status="failed", content=None, error=f"The stored {file_record.file_type.value} file could not be found.")
        else:
            try:
                if file_record.file_type == FileType.PDF:
                    result = extract_pdf_content(file_path)
                elif file_record.file_type == FileType.DOCUMENT:
                    result = extract_document_content(file_path)
                elif file_record.file_type == FileType.IMAGE:
                    result = extract_image_content(file_path, file_record.file_url)
                elif file_record.file_type == FileType.VIDEO:
                    result = extract_video_content(str(file_path), file_record)
                elif file_record.file_type == FileType.AUDIO:
                    result = extract_audio_content(str(file_path), file_record)
            finally:
                if is_temp and file_path and file_path.exists():
                    try:
                        file_path.unlink()
                    except Exception:
                        pass
    else:
        result = ExtractionResult(status="failed", content=None, error="Unsupported file type for extraction.")

    file_record.extracted_content = result.content
    file_record.extraction_status = result.status
    file_record.extraction_error = result.error
    file_record.extracted_at = datetime.now(timezone.utc)
    return result
