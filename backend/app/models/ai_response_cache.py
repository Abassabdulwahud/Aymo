from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class AIResponseCache(Base):
    __tablename__ = "ai_response_cache"
    __table_args__ = (
        UniqueConstraint(
            "note_id",
            "user_id",
            "provider",
            "question_hash",
            "context_hash",
            name="uq_ai_response_cache_lookup",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    question_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    context_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    encrypted_question: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    encrypted_response: Mapped[str] = mapped_column(Text, nullable=False)
    is_summarized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    note: Mapped["Note"] = relationship("Note", back_populates="ai_responses")
    user: Mapped["User"] = relationship("User")
