"""
Storage utilities — provider-agnostic helpers shared by all upload routes.

save_upload_file()       — thin shim that delegates to the active StorageProvider.
detect_upload_file_type()— classifies an UploadFile by extension / MIME type.
close_upload()           — safely closes the UploadFile stream.

The concrete upload implementation lives in app/storage/.
"""
from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, UploadFile

from ..models.enums import FileType

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
_DOCUMENT_EXTENSIONS = {
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".txt",
    ".rtf",
    ".md",
}


def detect_upload_file_type(upload: UploadFile) -> FileType:
    suffix = Path(upload.filename or "").suffix.lower()
    content_type = (upload.content_type or "").lower()

    if suffix in _IMAGE_EXTENSIONS or content_type.startswith("image/"):
        return FileType.IMAGE
    if suffix == ".pdf" or content_type == "application/pdf":
        return FileType.PDF
    if suffix in _VIDEO_EXTENSIONS or content_type.startswith("video/"):
        return FileType.VIDEO
    if suffix in _AUDIO_EXTENSIONS or content_type.startswith("audio/"):
        return FileType.AUDIO
    if suffix in _DOCUMENT_EXTENSIONS or content_type.startswith("text/") or content_type in {
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }:
        return FileType.DOCUMENT

    raise HTTPException(
        status_code=400,
        detail="Unsupported file type. Use image, PDF, document, video, or audio files.",
    )


def save_upload_file(upload: UploadFile, user_id: int, note_id: int) -> Tuple[str, int]:
    """
    Persist an uploaded file via the active storage provider.

    Returns (public_url, file_size_bytes).

    This function is kept for backward compatibility.  All new code should
    import get_storage_provider() from app.storage directly and call
    provider.upload() so the public_id (storage_key) is also accessible.
    """
    from ..storage import get_storage_provider
    provider = get_storage_provider()
    return provider.upload(upload, user_id, note_id)


def close_upload(upload: UploadFile) -> None:
    close_fn = getattr(upload.file, "close", None)
    if callable(close_fn):
        close_fn()
