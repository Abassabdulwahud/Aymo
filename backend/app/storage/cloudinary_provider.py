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
from typing import Any, Dict, Optional, Tuple

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

# ── Phase 4B.1 Signed Upload & Deletion Policy ────────────────────────────────

MAX_SIZE_IMAGE_AUDIO = 25 * 1024 * 1024    # 25 MB
MAX_SIZE_VIDEO_PDF   = 100 * 1024 * 1024   # 100 MB
MAX_SIZE_DOCUMENT    = 25 * 1024 * 1024    # 25 MB

ALLOWED_MIME_TYPES: dict[str, tuple[str, int]] = {
    # Images -> resource_type: image, max: 25MB
    "image/jpeg": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/jpg": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/png": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/gif": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/webp": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/svg+xml": ("image", MAX_SIZE_IMAGE_AUDIO),
    "image/bmp": ("image", MAX_SIZE_IMAGE_AUDIO),

    # Video -> resource_type: video, max: 100MB
    "video/mp4": ("video", MAX_SIZE_VIDEO_PDF),
    "video/webm": ("video", MAX_SIZE_VIDEO_PDF),
    "video/quicktime": ("video", MAX_SIZE_VIDEO_PDF),
    "video/x-msvideo": ("video", MAX_SIZE_VIDEO_PDF),
    "video/x-matroska": ("video", MAX_SIZE_VIDEO_PDF),

    # Audio -> resource_type: video (Cloudinary processes audio under video pipeline), max: 25MB
    "audio/mpeg": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/mp3": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/wav": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/x-wav": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/aac": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/ogg": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/flac": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/mp4": ("video", MAX_SIZE_IMAGE_AUDIO),
    "audio/x-m4a": ("video", MAX_SIZE_IMAGE_AUDIO),

    # PDF -> resource_type: raw, max: 100MB
    "application/pdf": ("raw", MAX_SIZE_VIDEO_PDF),

    # Documents -> resource_type: raw, max: 25MB
    "application/msword": ("raw", MAX_SIZE_DOCUMENT),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("raw", MAX_SIZE_DOCUMENT),
    "application/vnd.ms-excel": ("raw", MAX_SIZE_DOCUMENT),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("raw", MAX_SIZE_DOCUMENT),
    "application/vnd.ms-powerpoint": ("raw", MAX_SIZE_DOCUMENT),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ("raw", MAX_SIZE_DOCUMENT),
    "text/plain": ("raw", MAX_SIZE_DOCUMENT),
    "text/csv": ("raw", MAX_SIZE_DOCUMENT),
}

FORBIDDEN_MIME_PREFIXES = (
    "application/x-msdownload",
    "application/x-executable",
    "application/x-sh",
    "application/x-bat",
)


def validate_mime_and_size(mime_type: str, size_bytes: int) -> tuple[str, int]:
    """
    Validates client mime_type and size_bytes against server security policy.
    Returns (resource_type, max_allowed_bytes).
    Raises ValueError on validation failure.
    """
    if not mime_type or not isinstance(mime_type, str):
        raise ValueError("mimeType is required.")

    clean_mime = mime_type.strip().lower()

    for forbidden in FORBIDDEN_MIME_PREFIXES:
        if clean_mime.startswith(forbidden):
            raise ValueError(f"Forbidden file type: {clean_mime}")

    if clean_mime not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported MIME type: {clean_mime}")

    resource_type, max_bytes = ALLOWED_MIME_TYPES[clean_mime]

    if not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ValueError("sizeBytes must be a positive integer greater than 0.")

    if size_bytes > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise ValueError(f"File size exceeds maximum allowed limit of {max_mb} MB for this type.")

    return resource_type, max_bytes


def derive_attachment_cloudinary_identity(workspace_id: str, attachment_id: str) -> tuple[str, str]:
    """
    Derives server-controlled folder and public_id for sync attachment uploads.
    Namespace: {folder}/workspaces/{workspaceId}/{attachmentId}
    """
    settings = get_settings()
    base_folder = settings.cloudinary_folder or "aymo"
    folder = f"{base_folder}/workspaces/{workspace_id}"
    public_id = f"{folder}/{attachment_id}"
    return folder, public_id


def generate_signed_upload_params(
    workspace_id: str,
    attachment_id: str,
    mime_type: str,
    size_bytes: int,
) -> dict[str, Any]:
    """
    Validates MIME type & size, derives folder, public_id & resource_type,
    generates Cloudinary signature and returns upload parameters.
    """
    from datetime import datetime, timezone
    import cloudinary.utils

    resource_type, _ = validate_mime_and_size(mime_type, size_bytes)
    folder, public_id = derive_attachment_cloudinary_identity(workspace_id, attachment_id)

    settings = get_settings()
    cloud_name = settings.cloudinary_cloud_name or "aymo"
    api_key = settings.cloudinary_api_key or ""
    api_secret = settings.cloudinary_api_secret or ""

    timestamp = int(datetime.now(timezone.utc).timestamp())

    params_to_sign = {
        "folder": folder,
        "overwrite": "true",
        "public_id": public_id,
        "timestamp": str(timestamp),
        "unique_filename": "false",
    }

    try:
        signature = cloudinary.utils.api_sign_request(params_to_sign, api_secret)
    except Exception as exc:
        logger.error(f"[CLOUDINARY-SIGN] Failed to calculate signature: {exc}")
        raise RuntimeError("Cloudinary signature generation failed.") from exc

    upload_url = f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload"

    return {
        "cloudName": cloud_name,
        "apiKey": api_key,
        "timestamp": timestamp,
        "publicId": public_id,
        "folder": folder,
        "resourceType": resource_type,
        "signature": signature,
        "uploadUrl": upload_url,
    }


def delete_cloudinary_attachment(public_id: str, resource_type: Optional[str] = None) -> bool:
    """
    Deletes an asset from Cloudinary by public_id.
    Treats both 'ok' and 'not found' as successful (idempotent).
    Returns True if deletion succeeded or asset was already missing.
    Raises RuntimeError on Cloudinary API failure.
    """
    import cloudinary.uploader
    import cloudinary.exceptions

    rtypes = [resource_type] if resource_type in ("image", "video", "raw") else ["image", "video", "raw"]
    last_exc = None

    for rtype in rtypes:
        try:
            res = cloudinary.uploader.destroy(public_id, resource_type=rtype)
            res_val = res.get("result") if isinstance(res, dict) else ""
            if res_val in ("ok", "not found"):
                logger.info(f"[CLOUDINARY-DELETE] Destroyed public_id={public_id} (rtype={rtype}, result={res_val})")
                return True
        except cloudinary.exceptions.NotFound:
            return True
        except Exception as exc:
            logger.warning(f"[CLOUDINARY-DELETE] Error destroying public_id={public_id} (rtype={rtype}): {exc}")
            last_exc = exc

    if last_exc is not None:
        raise RuntimeError(f"Cloudinary deletion failed: {last_exc}") from last_exc

    return True



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
