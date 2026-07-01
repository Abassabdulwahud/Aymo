"""
Cloudinary storage provider.

Upload strategy:
  - Files are streamed directly from the incoming UploadFile buffer to Cloudinary.
  - Nothing is ever written to the local filesystem.
  - The Cloudinary resource_type is selected automatically:
      image   → image
      video   → video
      audio   → video  (Cloudinary uses resource_type=video for audio too)
      pdf     → raw
      document → raw
  - public_url is the Cloudinary secure_url.
  - storage_key is the Cloudinary public_id (used for deletion and transformations).

Startup validation:
  CloudinaryStorageProvider.__init__() raises RuntimeError if any of the three
  required credentials (cloud_name, api_key, api_secret) are missing.
"""
import io
import logging
from typing import Optional, Tuple

import cloudinary
import cloudinary.api
import cloudinary.uploader
from fastapi import UploadFile

from ..config import get_settings
from ..models.enums import FileType
from .base import StorageProvider

logger = logging.getLogger(__name__)

# Map our FileType to Cloudinary resource_type strings
_RESOURCE_TYPE_MAP: dict[FileType, str] = {
    FileType.IMAGE:    "image",
    FileType.VIDEO:    "video",
    FileType.AUDIO:    "video",   # Cloudinary treats audio as video resource_type
    FileType.PDF:      "raw",
    FileType.DOCUMENT: "raw",
    FileType.LINK:     "raw",
}


class CloudinaryStorageProvider(StorageProvider):
    """Upload / delete / query assets on Cloudinary."""

    def __init__(self) -> None:
        settings = get_settings()

        cloud_name = settings.cloudinary_cloud_name
        api_key = settings.cloudinary_api_key
        api_secret = settings.cloudinary_api_secret
        self._folder = settings.cloudinary_folder or "aymo"

        missing = [
            name
            for name, val in [
                ("CLOUDINARY_CLOUD_NAME", cloud_name),
                ("CLOUDINARY_API_KEY", api_key),
                ("CLOUDINARY_API_SECRET", api_secret),
            ]
            if not val
        ]
        if missing:
            raise RuntimeError(
                f"FILE_STORAGE_PROVIDER=cloudinary but the following required "
                f"environment variables are not set: {', '.join(missing)}"
            )

        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True,
        )
        logger.info(
            "CloudinaryStorageProvider initialised (cloud=%s, folder=%s)",
            cloud_name,
            self._folder,
        )

    # ------------------------------------------------------------------
    def upload(self, upload: UploadFile, user_id: int, note_id: int) -> Tuple[str, int]:
        from ..utils.storage import detect_upload_file_type

        try:
            file_type = detect_upload_file_type(upload)
        except Exception:
            file_type = FileType.DOCUMENT

        resource_type = _RESOURCE_TYPE_MAP.get(file_type, "raw")
        folder = f"{self._folder}/user-{user_id}/note-{note_id}"

        # Read the entire upload into memory so we can pass it to cloudinary.
        # For very large files (audio/video) this means RAM usage equals file size,
        # which is acceptable on Render/cloud workers. A streaming approach would
        # require a temp file anyway — using memory is simpler and avoids disk I/O.
        upload.file.seek(0)
        file_bytes = upload.file.read()
        file_size = len(file_bytes)

        # Use the original filename (without uuid prefix) as the public_id suffix so
        # Cloudinary filenames stay human-readable. Cloudinary deduplicates by adding
        # a unique suffix automatically when use_filename=True, unique_filename=True.
        original_name = upload.filename or "upload"

        logger.debug(
            "CloudinaryStorage: uploading '%s' as resource_type=%s to folder='%s' (%d bytes)",
            original_name,
            resource_type,
            folder,
            file_size,
        )

        result = cloudinary.uploader.upload(
            io.BytesIO(file_bytes),
            resource_type=resource_type,
            folder=folder,
            use_filename=True,
            unique_filename=True,
            overwrite=False,
            # For raw files, preserve the original file extension so content
            # stays downloadable with the right MIME type.
            format="" if resource_type == "raw" else None,
        )

        public_url: str = result["secure_url"]
        public_id: str = result["public_id"]

        # Store the public_id in the return value — callers that care will store it
        # separately.  We embed it in the tuple via a special attribute so we don't
        # break the (url, size) contract of the base interface.
        # Callers should retrieve it via the storage_key attribute after the call.
        self._last_public_id = public_id

        logger.info(
            "CloudinaryStorage: uploaded '%s' → %s (public_id=%s, %d bytes)",
            original_name,
            public_url,
            public_id,
            file_size,
        )
        return public_url, file_size

    # ------------------------------------------------------------------
    def delete(self, public_url: str, storage_key: Optional[str] = None) -> None:
        if not public_url and not storage_key:
            return

        if storage_key:
            # We know the public_id — use it directly for each resource_type.
            # We don't know the original resource_type, so we try all three.
            for rtype in ("image", "video", "raw"):
                try:
                    result = cloudinary.uploader.destroy(storage_key, resource_type=rtype)
                    if result.get("result") == "ok":
                        logger.debug(
                            "CloudinaryStorage: deleted public_id='%s' (resource_type=%s)",
                            storage_key,
                            rtype,
                        )
                        return
                except cloudinary.exceptions.Error:
                    continue
        else:
            logger.warning(
                "CloudinaryStorage: delete called without storage_key for url='%s'; "
                "cannot reliably delete — no action taken.",
                public_url,
            )

    # ------------------------------------------------------------------
    def exists(self, public_url: str, storage_key: Optional[str] = None) -> bool:
        if not storage_key:
            # Without public_id we can't reliably query Cloudinary.
            return bool(public_url)

        for rtype in ("image", "video", "raw"):
            try:
                cloudinary.api.resource(storage_key, resource_type=rtype)
                return True
            except cloudinary.exceptions.NotFound:
                continue
            except Exception:
                continue
        return False

    # ------------------------------------------------------------------
    def get_url(self, storage_key: str) -> str:
        # Build a basic secure delivery URL from the public_id.
        # The cloudinary.CloudinaryImage helper produces the canonical URL.
        from cloudinary import CloudinaryImage
        return CloudinaryImage(storage_key).build_url(secure=True)

    # ------------------------------------------------------------------
    @property
    def last_public_id(self) -> Optional[str]:
        """Return the public_id from the most recent upload() call."""
        return getattr(self, "_last_public_id", None)
