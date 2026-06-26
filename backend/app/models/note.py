from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .associations import note_tags


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_favorited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    conversation_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="notes")
    tags: Mapped[List["Tag"]] = relationship("Tag", secondary=note_tags, back_populates="notes")
    files: Mapped[List["File"]] = relationship("File", back_populates="note", cascade="all, delete-orphan")
    sources: Mapped[List["Source"]] = relationship("Source", back_populates="note", cascade="all, delete-orphan")
    extracted_contents: Mapped[List["ExtractedContent"]] = relationship(
        "ExtractedContent",
        back_populates="note",
        cascade="all, delete-orphan",
    )
    ai_responses: Mapped[List["AIResponseCache"]] = relationship(
        "AIResponseCache",
        back_populates="note",
        cascade="all, delete-orphan",
    )
    embeddings: Mapped[List["NoteEmbedding"]] = relationship(
        "NoteEmbedding",
        back_populates="note",
        cascade="all, delete-orphan",
    )
