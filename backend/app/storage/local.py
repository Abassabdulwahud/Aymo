"""
Local filesystem storage provider.

Preserves the exact behaviour of the original save_upload_file() helper:
  - Files are stored at  <uploads_dir>/user-{user_id}/note-{note_id}/{uuid}-{name}
  - URLs are served at   <uploads_base_url>/user-{user_id}/note-{note_id}/{uuid}-{name}
  - JPEG / WEBP images are compressed with PIL before being stored.
"""
import logging
import shutil
from pathlib import Path
from typing import Optional, Tuple
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image

from ..config import get_settings
from ..models.enums import FileType
from .base import StorageProvider

logger = logging.getLogger(__name__)


def _sanitize_filename(filename: str) -> str:
    cleaned = "".join(c for c in filename if c.isalnum() or c in {"-", "_", "."})
    return cleaned or "upload"


def _compress_image_file(path: Path) -> None:
    settings = get_settings()
    with Image.open(path) as image:
        image.thumbnail((settings.image_max_dimension, settings.image_max_dimension))
        save_kwargs: dict = {"optimize": True}
        image_format = (image.format or path.suffix.lstrip(".") or "PNG").upper()
        if image_format in {"JPG", "JPEG", "WEBP"}:
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            save_kwargs["quality"] = settings.image_quality
        image.save(path, format=image_format, **save_kwargs)


class LocalStorageProvider(StorageProvider):
    """Store files on the local filesystem, served via FastAPI StaticFiles."""

    def __init__(self) -> None:
        settings = get_settings()
        self._uploads_dir = settings.uploads_dir
        self._uploads_base_url = settings.uploads_base_url

    # ------------------------------------------------------------------
    def upload(self, upload: UploadFile, user_id: int, note_id: int) -> Tuple[str, int]:
        uploads_root = Path(self._uploads_dir).resolve()
        target_dir = uploads_root / f"user-{user_id}" / f"note-{note_id}"
        target_dir.mkdir(parents=True, exist_ok=True)

        original_name = _sanitize_filename(upload.filename or "upload")
        stored_name = f"{uuid4().hex}-{original_name}"
        target_path = target_dir / stored_name

        upload.file.seek(0)
        with target_path.open("wb") as dest:
            shutil.copyfileobj(upload.file, dest)

        # Detect type from filename/content-type to decide on compression
        from ..utils.storage import detect_upload_file_type
        try:
            file_type = detect_upload_file_type(upload)
            if file_type == FileType.IMAGE:
                _compress_image_file(target_path)
        except Exception:
            pass  # If detection fails, skip compression — don't block the upload

        relative_path = target_path.relative_to(uploads_root).as_posix()
        public_url = f"{self._uploads_base_url.rstrip('/')}/{relative_path}"
        file_size = target_path.stat().st_size

        logger.debug("LocalStorage: saved '%s' → %s (%d bytes)", upload.filename, public_url, file_size)
        return public_url, file_size

    # ------------------------------------------------------------------
    def delete(self, public_url: str, storage_key: Optional[str] = None) -> None:
        if not public_url or not public_url.startswith(self._uploads_base_url):
            return

        relative_parts = [
            part
            for part in public_url[len(self._uploads_base_url):].split("/")
            if part
        ]
        file_path = Path(self._uploads_dir).resolve().joinpath(*relative_parts)
        if not file_path.exists():
            return

        try:
            file_path.unlink()
            logger.debug("LocalStorage: deleted '%s'", file_path)
        except OSError as exc:
            logger.warning("LocalStorage: could not delete '%s': %s", file_path, exc)

    # ------------------------------------------------------------------
    def exists(self, public_url: str, storage_key: Optional[str] = None) -> bool:
        if not public_url or not public_url.startswith(self._uploads_base_url):
            return False

        relative_parts = [
            part
            for part in public_url[len(self._uploads_base_url):].split("/")
            if part
        ]
        file_path = Path(self._uploads_dir).resolve().joinpath(*relative_parts)
        return file_path.exists()

    # ------------------------------------------------------------------
    def get_url(self, storage_key: str) -> str:
        # For local storage, storage_key IS the relative URL path segment
        return f"{self._uploads_base_url.rstrip('/')}/{storage_key.lstrip('/')}"
