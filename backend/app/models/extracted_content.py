from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class ExtractedContent(Base):
    __tablename__ = "extracted_contents"
    __table_args__ = (
        UniqueConstraint("note_id", "file_id", "source_type", name="uq_extracted_contents_note_file_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id: Mapped[Optional[int]] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_label: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    encrypted_content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="completed", nullable=False, index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    note: Mapped["Note"] = relationship("Note", back_populates="extracted_contents")
    file: Mapped[Optional["File"]] = relationship("File", back_populates="extracted_items")
    user: Mapped["User"] = relationship("User")
