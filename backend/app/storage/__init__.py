"""
Public API of the storage package.

    from app.storage import get_storage_provider, StorageProvider
"""
from .base import StorageProvider
from .factory import get_storage_provider

__all__ = ["StorageProvider", "get_storage_provider"]
