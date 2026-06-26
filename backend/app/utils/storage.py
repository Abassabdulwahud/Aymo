from pathlib import Path
from typing import Tuple
from uuid import uuid4
import shutil

from fastapi import HTTPException, UploadFile
from PIL import Image

from ..config import get_settings
from ..models.enums import FileType

settings = get_settings()

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


def _sanitize_filename(filename: str) -> str:
    cleaned = "".join(character for character in filename if character.isalnum() or character in {"-", "_", "."})
    return cleaned or "upload"


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

    raise HTTPException(status_code=400, detail="Unsupported file type. Use image, PDF, document, video, or audio files.")


def _compress_image_file(source_path: Path) -> None:
    with Image.open(source_path) as image:
        image.thumbnail((settings.image_max_dimension, settings.image_max_dimension))
        save_kwargs = {"optimize": True}
        image_format = (image.format or source_path.suffix.lstrip(".") or "PNG").upper()
        if image_format in {"JPG", "JPEG", "WEBP"}:
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            save_kwargs["quality"] = settings.image_quality
        image.save(source_path, format=image_format, **save_kwargs)


def save_upload_file(upload: UploadFile, user_id: int, note_id: int) -> Tuple[str, int]:
    uploads_root = Path(settings.uploads_dir).resolve()
    target_dir = uploads_root / f"user-{user_id}" / f"note-{note_id}"
    target_dir.mkdir(parents=True, exist_ok=True)

    original_name = _sanitize_filename(upload.filename or "upload")
    stored_name = f"{uuid4().hex}-{original_name}"
    target_path = target_dir / stored_name

    upload.file.seek(0)
    with target_path.open("wb") as destination:
        shutil.copyfileobj(upload.file, destination)

    file_type = detect_upload_file_type(upload)
    if file_type == FileType.IMAGE:
        _compress_image_file(target_path)

    relative_path = target_path.relative_to(uploads_root).as_posix()
    public_url = f"{settings.uploads_base_url.rstrip('/')}/{relative_path}"
    file_size = target_path.stat().st_size
    return public_url, file_size


def close_upload(upload: UploadFile) -> None:
    close_fn = getattr(upload.file, "close", None)
    if callable(close_fn):
        close_fn()
