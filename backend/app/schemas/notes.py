from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TagSummary(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class FileSummary(BaseModel):
    id: int
    file_name: str
    file_type: str
    file_url: str
    file_size: int
    extraction_status: str
    extraction_error: Optional[str] = None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NoteBase(BaseModel):
    title: str = Field(default="", max_length=500)
    body: str = Field(default="")
    is_pinned: bool = False
    is_favorited: bool = False
    tag_ids: List[int] = Field(default_factory=list)


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=500)
    body: Optional[str] = None
    is_pinned: Optional[bool] = None
    is_favorited: Optional[bool] = None
    tag_ids: Optional[List[int]] = None


class NoteStateUpdate(BaseModel):
    value: bool


class NoteResponse(BaseModel):
    id: int
    user_id: int
    title: str
    body: str
    is_pinned: bool
    is_favorited: bool
    created_at: datetime
    updated_at: datetime
    tags: List[TagSummary] = Field(default_factory=list)
    files: List[FileSummary] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class NoteListResponse(BaseModel):
    items: List[NoteResponse]
    total: int
