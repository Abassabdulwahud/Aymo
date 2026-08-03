from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Annotation(Base):
    """
    Universal annotation record.

    source_type is an open string discriminator (e.g. "pdf", "note", "ai",
    "web") so future document types can be added without schema changes.
    source_id is the opaque integer primary key of the annotated document
    (e.g. Source.id for PDFs, Note.id for note annotations).

    bounding_rects stores a JSON array of {x, y, width, height, pageIndex}
    objects (relative coordinates 0–1 within the page) captured from the
    browser's Range.getClientRects() at creation time.  This lets the UI
    reconstruct accurate overlays without re-parsing the document.
    """

    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # ---------- document identity ----------
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ---------- selection ----------
    selected_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # JSON: List[{x, y, width, height}] — relative to rendered page dimensions
    bounding_rects: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    # character offsets within the page text content (for re-selecting)
    start_offset: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_offset: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ---------- appearance ----------
    color: Mapped[str] = mapped_column(String(32), nullable=False, default="#FFD60A")
    # "highlight" | "underline" | "strikethrough" | "comment" | "bookmark"
    annotation_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="highlight"
    )

    # ---------- content ----------
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    linked_note_id: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, index=True
    )

    # ---------- timestamps ----------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User")
