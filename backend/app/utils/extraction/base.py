"""
Base types and helpers for the extraction pipeline.

resolve_file_for_extraction()
    Unified entry point for processors that need a local Path to a file.
    - For local storage: resolves the existing on-disk path (no download).
    - For remote URLs (Cloudinary, etc.): downloads the file to a NamedTemporaryFile
      and returns (temp_path, is_temp=True). The caller MUST clean up the temp file.

file_path_from_uploads_root()
    Low-level helper kept for backward compatibility.
    Only works for local /uploads/… URLs; returns None for remote URLs.
"""
import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class ExtractionResult:
    status: str
    content: Optional[str]
    error: Optional[str] = None
    metadata: Optional[dict] = None


def file_path_from_uploads_root(uploads_dir: str, uploads_base_url: str, file_url: str) -> Optional[Path]:
    """
    Resolve a /uploads/… URL to an absolute local Path.

    Returns None for any URL that does not start with uploads_base_url
    (e.g. Cloudinary https:// URLs).
    """
    if not file_url.startswith(uploads_base_url):
        return None

    relative_path = file_url[len(uploads_base_url):].strip("/")
    if not relative_path:
        return None

    return Path(uploads_dir).resolve() / Path(relative_path)


def resolve_file_for_extraction(
    public_url: str,
    storage_key: Optional[str] = None,
) -> Tuple[Optional[Path], bool]:
    """
    Return (local_path, is_temp) for a stored file.

    local_path — absolute Path to use for reading; None if the URL is invalid / unreachable.
    is_temp    — True when the caller is responsible for deleting local_path after use.

    Algorithm:
        1. If public_url starts with uploads_base_url → local file; return the path (is_temp=False).
        2. If public_url is an http(s) URL → download to a NamedTemporaryFile; return (temp_path, True).
        3. Otherwise → return (None, False).
    """
    from ...config import get_settings
    settings = get_settings()

    # Case 1 — local file already on disk
    local_path = file_path_from_uploads_root(
        settings.uploads_dir, settings.uploads_base_url, public_url
    )
    if local_path is not None:
        if local_path.exists():
            return local_path, False
        logger.warning("resolve_file_for_extraction: local path %s does not exist", local_path)
        return None, False

    # Case 2 — remote URL (Cloudinary or any HTTPS source)
    if public_url.startswith("http://") or public_url.startswith("https://"):
        return _download_to_temp(public_url)

    logger.warning("resolve_file_for_extraction: unrecognised URL scheme for '%s'", public_url)
    return None, False


def _download_to_temp(url: str) -> Tuple[Optional[Path], bool]:
    """
    Download a remote file to a NamedTemporaryFile and return (path, True).
    Returns (None, False) on any network / IO failure.
    """
    import requests

    logger.info("Downloading remote file for extraction: %s", url)
    try:
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()

        # Preserve the original file extension (needed by some parsers, e.g. PyMuPDF for PDF).
        suffix = _suffix_from_url(url)

        # delete=False so the caller can control when the file is removed.
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    tmp.write(chunk)
        finally:
            tmp.flush()
            tmp.close()

        logger.info("Downloaded %s → %s", url, tmp.name)
        return Path(tmp.name), True

    except Exception as exc:
        logger.error("Failed to download '%s' for extraction: %s", url, exc)
        return None, False


def _suffix_from_url(url: str) -> str:
    """Extract the file extension from a URL path, e.g. '.pdf', '.mp4'."""
    from urllib.parse import urlparse
    path = urlparse(url).path
    suffix = Path(path).suffix
    # Cloudinary raw URLs may not carry extensions; fall back to empty string.
    return suffix if suffix else ""
