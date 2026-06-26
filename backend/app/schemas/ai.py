from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from ..models.enums import AIProvider


class AIChatRequest(BaseModel):
    note_id: int
    message: str = Field(min_length=1, max_length=5000)
    ai_provider: Optional[AIProvider] = None


class AIChatResponse(BaseModel):
    note_id: int
    provider: str
    response: str
    cached: bool


class AIResponseItem(BaseModel):
    id: str
    provider: str
    question: str
    response: str
    created_at: str


class AIResponseList(BaseModel):
    items: List[AIResponseItem]
    total: int


class ContentSyncRequest(BaseModel):
    note_id: int
    title: Optional[str] = None
    body: str = ""


class ContentSyncResponse(BaseModel):
    note_id: int
    synced_at: datetime


class FileJobRequest(BaseModel):
    file_id: int
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    transcript_text: Optional[str] = None


class FileJobResponse(BaseModel):
    file_id: int
    task_id: str
    status: str
    message: str


class ExtractedContentResponse(BaseModel):
    id: int
    note_id: int
    file_id: Optional[int]
    source_type: str
    source_label: str
    source_url: Optional[str]
    status: str
    error: Optional[str]
    created_at: datetime
    updated_at: datetime
    content: str

    model_config = ConfigDict(from_attributes=True)
