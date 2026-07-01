from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, DateTime, Enum as SqlEnum, ForeignKey, Integer, String, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .enums import SourceType, SourceStatus


def _enum_values(enum_cls):
    return [member.value for member in enum_cls]


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type: Mapped[SourceType] = mapped_column(
        SqlEnum(SourceType, name="source_type_enum", values_callable=_enum_values),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    public_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    # Storage-provider metadata — NULL for records created before this feature.
    storage_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    cdn_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[SourceStatus] = mapped_column(
        SqlEnum(SourceStatus, name="source_status_enum", values_callable=_enum_values),
        default=SourceStatus.UPLOADED,
        nullable=False,
    )
    processing_progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processing_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    keywords: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    note: Mapped["Note"] = relationship("Note", back_populates="sources")
    user: Mapped["User"] = relationship("User", back_populates="sources")
    chunks: Mapped[List["SourceChunk"]] = relationship(
        "SourceChunk",
        back_populates="source",
        cascade="all, delete-orphan",
    )
    summaries: Mapped[List["SourceSummary"]] = relationship(
        "SourceSummary",
        back_populates="source",
        cascade="all, delete-orphan",
    )
    embeddings: Mapped[List["NoteEmbedding"]] = relationship(
        "NoteEmbedding",
        back_populates="source",
        cascade="all, delete-orphan",
    )

    # --- Backward compatibility properties for File interface ---
    @property
    def file_name(self) -> str:
        return self.title

    @file_name.setter
    def file_name(self, value: str):
        self.title = value

    @property
    def file_url(self) -> str:
        return self.public_url or ""

    @file_url.setter
    def file_url(self, value: str):
        self.public_url = value

    @property
    def progress_percent(self) -> int:
        return self.processing_progress

    @progress_percent.setter
    def progress_percent(self, value: int):
        self.processing_progress = value

    @property
    def extraction_status(self) -> str:
        status_map = {
            SourceStatus.UPLOADED: "pending",
            SourceStatus.QUEUED: "queued",
            SourceStatus.PROCESSING: "processing",
            SourceStatus.PARTIALLY_READY: "processing",
            SourceStatus.READY: "completed",
            SourceStatus.FAILED: "failed",
        }
        return status_map.get(self.status, "pending")

    @extraction_status.setter
    def extraction_status(self, value: str):
        status_map = {
            "pending": SourceStatus.UPLOADED,
            "queued": SourceStatus.QUEUED,
            "processing": SourceStatus.PROCESSING,
            "completed": SourceStatus.READY,
            "failed": SourceStatus.FAILED,
        }
        self.status = status_map.get(value, SourceStatus.UPLOADED)

    @property
    def extraction_error(self) -> Optional[str]:
        return self.processing_error

    @extraction_error.setter
    def extraction_error(self, value: Optional[str]):
        self.processing_error = value

    @property
    def file_type(self):
        from .enums import FileType
        try:
            return FileType[self.source_type.name]
        except KeyError:
            return FileType.DOCUMENT

    @property
    def detailed_steps(self) -> Optional[str]:
        from ..services.cache import cache_client
        data = cache_client.get_json(f"source:{self.id}:detailed_steps")
        return data.get("value") if data else None

    @detailed_steps.setter
    def detailed_steps(self, value: Optional[str]):
        from ..services.cache import cache_client
        if value:
            cache_client.set_json(f"source:{self.id}:detailed_steps", {"value": value}, 86400)
        else:
            cache_client.set_json(f"source:{self.id}:detailed_steps", {}, 1)

    @property
    def processed_chunks(self) -> int:
        from ..services.cache import cache_client
        data = cache_client.get_json(f"source:{self.id}:processed_chunks")
        return data.get("value", 0) if data else 0

    @processed_chunks.setter
    def processed_chunks(self, value: int):
        from ..services.cache import cache_client
        cache_client.set_json(f"source:{self.id}:processed_chunks", {"value": value}, 86400)

    @property
    def total_chunks(self) -> int:
        from ..services.cache import cache_client
        data = cache_client.get_json(f"source:{self.id}:total_chunks")
        return data.get("value", 0) if data else 0

    @total_chunks.setter
    def total_chunks(self, value: int):
        from ..services.cache import cache_client
        cache_client.set_json(f"source:{self.id}:total_chunks", {"value": value}, 86400)

    @property
    def partial_transcript(self) -> Optional[str]:
        from ..services.cache import cache_client
        data = cache_client.get_json(f"source:{self.id}:partial_transcript")
        return data.get("value") if data else None

    @partial_transcript.setter
    def partial_transcript(self, value: Optional[str]):
        from ..services.cache import cache_client
        if value:
            cache_client.set_json(f"source:{self.id}:partial_transcript", {"value": value}, 86400)
        else:
            cache_client.set_json(f"source:{self.id}:partial_transcript", {}, 1)

