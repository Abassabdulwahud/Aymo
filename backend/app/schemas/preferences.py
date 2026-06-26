from typing import Optional

from pydantic import BaseModel, Field

from ..models.enums import AIProvider, ThemePreference


class PreferencesResponse(BaseModel):
    aiProvider: AIProvider
    theme: ThemePreference
    language: str
    languageCode: Optional[str] = None


class PreferencesUpdate(BaseModel):
    aiProvider: Optional[AIProvider] = None
    theme: Optional[ThemePreference] = None
    language: Optional[str] = Field(default=None, min_length=1, max_length=50)
