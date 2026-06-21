from typing import List

from pydantic import BaseModel, ConfigDict, Field


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class TagUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class TagResponse(BaseModel):
    id: int
    user_id: int
    name: str
    note_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class TagListResponse(BaseModel):
    items: List[TagResponse]
    total: int
