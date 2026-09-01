"""
Pydantic Document Models for MongoDB Atlas collections in AYMO.
These models represent the cloud replica documents for local-first synchronization.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── User Document ─────────────────────────────────────────────────────────────

class UserDoc(BaseModel):
    id: str = Field(alias="_id")
    email: str
    full_name: Optional[str] = None
    password_hash: Optional[str] = None
    provider: str = "email"  # "email" | "google" | "apple"
    preferred_ai_provider: Optional[str] = "gemini"
    preferred_theme: Optional[str] = "light"
    preferred_language: Optional[str] = "en"
    created_at: str = Field(default_factory=utc_now_iso)
    last_login_at: Optional[str] = None

    class Config:
        populate_by_name = True


# ─── Workspace Document ────────────────────────────────────────────────────────

class WorkspaceDoc(BaseModel):
    id: str = Field(alias="_id")  # Stable local workspace UUID
    owner_user_id: str
    name: str = "Default Workspace"
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── Note Document ─────────────────────────────────────────────────────────────

class NoteDoc(BaseModel):
    id: str = Field(alias="_id")  # Stable local UUID preserved as primary key
    user_id: str
    workspace_id: str
    title: str = ""
    body: str = ""  # TipTap HTML
    is_pinned: bool = False
    is_favorited: bool = False
    tags: List[str] = Field(default_factory=list)  # Embedded tag strings
    files: List[str] = Field(default_factory=list)  # Attached file IDs
    version: int = 1
    deleted_at: Optional[str] = None  # Non-null indicates soft-deleted (trash)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── File/Attachment Document ──────────────────────────────────────────────────

class FileDoc(BaseModel):
    id: str = Field(alias="_id")  # Stable local UUID preserved as primary key
    note_id: str
    user_id: str
    file_name: str
    file_type: str  # "image" | "pdf" | "document" | "video" | "audio" | "link"
    file_url: str  # Cloudinary secure CDN URL or link URL
    file_size: int = 0  # bytes
    storage_key: Optional[str] = None  # Cloudinary public_id
    extraction_status: str = "queued"  # "local_only" | "queued" | "processing" | "completed" | "failed" | "deleted"
    extracted_text: Optional[str] = None  # Text content extracted for AI/Search
    extraction_error: Optional[str] = None
    progress_percent: Optional[int] = 0
    detailed_steps: Optional[str] = None  # JSON string representation
    duration_seconds: Optional[int] = None
    uploaded_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── Annotation Document ───────────────────────────────────────────────────────

class AnnotationDoc(BaseModel):
    id: str = Field(alias="_id")
    user_id: str
    source_type: str  # "pdf" | "note" | "ai" | "web"
    source_id: str
    page_number: Optional[int] = None
    selected_text: str = ""
    bounding_rects: Optional[List[Dict[str, Any]]] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    color: str = "#FFE082"
    annotation_type: str = "highlight"  # "highlight" | "underline" | "strikethrough" | "comment" | "bookmark"
    comment: Optional[str] = None
    linked_note_id: Optional[str] = None
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── AI Cache Document ─────────────────────────────────────────────────────────

class AiCacheDoc(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str
    note_id: str
    provider: str
    question: str
    response: str
    created_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── Remote Mapping Document ───────────────────────────────────────────────────

class RemoteMappingDoc(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    workspace_id: str
    user_id: Optional[str] = None
    entity_type: str  # "note" | "file" | "annotation" | "tag"
    local_id: str
    remote_id: str
    created_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True


# ─── Tombstone Document ────────────────────────────────────────────────────────

class TombstoneDoc(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    workspace_id: str
    user_id: Optional[str] = None
    entity_type: str
    local_id: str
    remote_id: str
    deleted_at: str = Field(default_factory=utc_now_iso)

    class Config:
        populate_by_name = True
