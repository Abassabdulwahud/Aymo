"""
Storage provider abstraction.

Every concrete provider must implement upload(), delete(), exists(), and get_url().
No upload route or worker should import a concrete provider directly — use
get_storage_provider() from app.storage.factory instead.
"""
from abc import ABC, abstractmethod
from typing import Optional, Tuple

from fastapi import UploadFile


class StorageProvider(ABC):
    """
    Interface that all storage backends must satisfy.

    upload()   — persist the incoming file bytes and return (public_url, file_size_bytes).
    delete()   — remove an asset given its public URL and optional provider-specific key.
    exists()   — check whether an asset is still present in the backend.
    get_url()  — reconstruct the public URL from a provider-specific storage key.
    """

    @abstractmethod
    def upload(self, upload: UploadFile, user_id: int, note_id: int) -> Tuple[str, int]:
        """
        Persist the file and return (public_url, file_size_in_bytes).

        The public_url must be a fully accessible URL — either a local path
        served by FastAPI's StaticFiles, or an absolute HTTPS URL.
        """

    @abstractmethod
    def delete(self, public_url: str, storage_key: Optional[str] = None) -> None:
        """
        Delete the stored asset.

        For local storage, the public_url is enough.
        For cloud storage, storage_key (e.g. Cloudinary public_id) is preferred.
        Implementations must be idempotent — deleting a missing asset is not an error.
        """

    @abstractmethod
    def exists(self, public_url: str, storage_key: Optional[str] = None) -> bool:
        """Return True if the asset is accessible in the backend."""

    @abstractmethod
    def get_url(self, storage_key: str) -> str:
        """Return the public URL for a given provider-specific storage key."""
