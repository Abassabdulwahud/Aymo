from sqlalchemy import Column, ForeignKey, Index, Integer, Table

from ..database import Base


note_tags = Table(
    "note_tags",
    Base.metadata,
    Column("note_id", Integer, ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_note_tags_note_id_tag_id", "note_id", "tag_id", unique=True),
)
