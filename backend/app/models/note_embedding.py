from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class NoteEmbedding(Base):
    __tablename__ = "note_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id: Mapped[Optional[int]] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=True, index=True)
    source_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=True, index=True)
    content_chunk: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_vector: Mapped[List[float]] = mapped_column(JSON, nullable=False)
    chunk_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    note: Mapped["Note"] = relationship("Note", back_populates="embeddings")
    file: Mapped[Optional["File"]] = relationship("File", back_populates="embeddings")
    source: Mapped[Optional["Source"]] = relationship("Source", back_populates="embeddings")

