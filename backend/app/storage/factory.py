"""
Factory that reads FILE_STORAGE_PROVIDER and returns the appropriate provider.

Usage:
    from app.storage import get_storage_provider

    provider = get_storage_provider()
    public_url, file_size = provider.upload(upload_file, user_id, note_id)
"""
import logging
import os

from .base import StorageProvider

logger = logging.getLogger(__name__)


def get_storage_provider() -> StorageProvider:
    """
    Return the configured StorageProvider implementation.

    Reads FILE_STORAGE_PROVIDER from the environment (or .env).
    Supported values:
        local       — LocalStorageProvider (default)
        cloudinary  — CloudinaryStorageProvider

    Raises RuntimeError at startup if 'cloudinary' is selected but
    credentials are incomplete.
    """
    provider_name = os.getenv("FILE_STORAGE_PROVIDER", "local").strip().lower()

    if provider_name == "cloudinary":
        from .cloudinary_provider import CloudinaryStorageProvider
        provider = CloudinaryStorageProvider()
        logger.info("Storage provider: Cloudinary")
        return provider

    if provider_name != "local":
        logger.warning(
            "Unknown FILE_STORAGE_PROVIDER='%s'; falling back to local storage.",
            provider_name,
        )

    from .local import LocalStorageProvider
    provider = LocalStorageProvider()
    logger.info("Storage provider: Local filesystem")
    return provider
