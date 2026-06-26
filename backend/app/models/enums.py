from enum import Enum


class AIProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    DEEPSEEK = "deepseek"


class ThemePreference(str, Enum):
    LIGHT = "light"
    DARK = "dark"


class FileType(str, Enum):
    IMAGE = "image"
    PDF = "pdf"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    LINK = "link"


class SourceType(str, Enum):
    PDF = "pdf"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    LINK = "link"
    IMAGE = "image"


class SourceStatus(str, Enum):
    UPLOADED = "uploaded"
    QUEUED = "queued"
    PROCESSING = "processing"
    PARTIALLY_READY = "partially_ready"
    READY = "ready"
    FAILED = "failed"

