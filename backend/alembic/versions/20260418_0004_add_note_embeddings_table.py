"""add note embeddings table

Revision ID: 20260418_0004
Revises: 20260411_0003
Create Date: 2026-04-18 22:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260418_0004"
down_revision: Union[str, None] = "20260411_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "note_embeddings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.Integer(), nullable=True),
        sa.Column("content_chunk", sa.Text(), nullable=False),
        sa.Column("embedding_vector", sa.JSON(), nullable=False),
        sa.Column("chunk_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_note_embeddings_id", "note_embeddings", ["id"], unique=False)
    op.create_index("ix_note_embeddings_note_id", "note_embeddings", ["note_id"], unique=False)
    op.create_index("ix_note_embeddings_file_id", "note_embeddings", ["file_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_note_embeddings_file_id", table_name="note_embeddings")
    op.drop_index("ix_note_embeddings_note_id", table_name="note_embeddings")
    op.drop_index("ix_note_embeddings_id", table_name="note_embeddings")
    op.drop_table("note_embeddings")
