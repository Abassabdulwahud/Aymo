from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class FileResponse(BaseModel):
    id: int
    note_id: int
    user_id: int
    file_name: str
    file_type: str
    file_url: str
    file_size: int
    extracted_content: Optional[str] = None
    extraction_status: str
    extraction_error: Optional[str] = None
    viewer_notes: Optional[str] = None
    progress_percent: int = 0
    detailed_steps: Optional[str] = None
    processed_chunks: int = 0
    total_chunks: int = 0
    extracted_at: Optional[datetime] = None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FileListResponse(BaseModel):
    items: List[FileResponse]
    total: int


class LinkCreate(BaseModel):
    url: HttpUrl
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)


class FileExtractRequest(BaseModel):
    file_id: int


class FileExtractResponse(BaseModel):
    item: FileResponse
    message: str
