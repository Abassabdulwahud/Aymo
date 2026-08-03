from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class BoundingRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class AnnotationCreate(BaseModel):
    source_type: str = Field(..., max_length=32)
    source_id: int
    page_number: Optional[int] = None
    selected_text: str = ""
    bounding_rects: Optional[List[Dict[str, Any]]] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    color: str = Field(default="#FFD60A", max_length=32)
    annotation_type: str = Field(default="highlight", max_length=32)
    comment: Optional[str] = None
    linked_note_id: Optional[int] = None


class AnnotationUpdate(BaseModel):
    color: Optional[str] = Field(default=None, max_length=32)
    annotation_type: Optional[str] = Field(default=None, max_length=32)
    comment: Optional[str] = None
    linked_note_id: Optional[int] = None


class AnnotationRead(BaseModel):
    id: int
    user_id: int
    source_type: str
    source_id: int
    page_number: Optional[int]
    selected_text: str
    bounding_rects: Optional[List[Dict[str, Any]]]
    start_offset: Optional[int]
    end_offset: Optional[int]
    color: str
    annotation_type: str
    comment: Optional[str]
    linked_note_id: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AnnotationListResponse(BaseModel):
    items: List[AnnotationRead]
    total: int
