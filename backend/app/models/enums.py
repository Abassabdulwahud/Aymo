from enum import Enum


class AIProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    DEEPSEEK = "deepseek"


class ThemePreference(str, Enum):
    LIGHT = "light"
    DARK = "dark"


class FileType(str, Enum):
    PDF = "pdf"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    LINK = "link"
