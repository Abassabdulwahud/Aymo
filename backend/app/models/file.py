from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, DateTime, Enum as SqlEnum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .enums import FileType


def _enum_values(enum_cls):
    return [member.value for member in enum_cls]


class File(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[FileType] = mapped_column(
        SqlEnum(FileType, name="file_type_enum", values_callable=_enum_values),
        nullable=False,
    )
    file_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # Storage-provider metadata — NULL for records created before this feature.
    storage_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    cdn_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    extracted_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extraction_status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    extraction_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    viewer_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detailed_steps: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processed_chunks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    partial_transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    note: Mapped["Note"] = relationship("Note", back_populates="files")
    user: Mapped["User"] = relationship("User", back_populates="files")
    extracted_items: Mapped[List["ExtractedContent"]] = relationship(
        "ExtractedContent",
        back_populates="file",
        cascade="all, delete-orphan",
    )
    embeddings: Mapped[List["NoteEmbedding"]] = relationship(
        "NoteEmbedding",
        back_populates="file",
        cascade="all, delete-orphan",
    )
