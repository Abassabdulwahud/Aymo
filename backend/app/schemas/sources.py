from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class SourceChunkResponse(BaseModel):
    id: int
    source_id: int
    chunk_index: int
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    text: str
    word_count: int
    chunk_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SourceResponse(BaseModel):
    id: int
    note_id: int
    user_id: int
    source_type: str
    title: str
    original_filename: Optional[str] = None
    file_size: int
    duration_seconds: Optional[int] = None
    mime_type: Optional[str] = None
    public_url: Optional[str] = None
    content_hash: Optional[str] = None
    status: str
    processing_progress: int = 0
    processing_error: Optional[str] = None
    summary: Optional[str] = None
    keywords: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SourceListResponse(BaseModel):
    items: List[SourceResponse]
    total: int


class SourceStatusResponse(BaseModel):
    id: int
    status: str
    processing_progress: int
    processing_error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class SourceTranscriptResponse(BaseModel):
    items: List[SourceChunkResponse]
    total: int


class SourceSummaryResponse(BaseModel):
    id: int
    source_id: int
    user_id: int
    summary_text: str
    topics: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    model_used: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SourceProcessRequest(BaseModel):
    force: bool = False
