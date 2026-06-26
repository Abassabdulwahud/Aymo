"""add ai content tables

Revision ID: 20260411_0003
Revises: 20260406_0002
Create Date: 2026-04-11 18:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260411_0003"
down_revision: Union[str, None] = "20260406_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE notes SET last_synced_at = COALESCE(updated_at, CURRENT_TIMESTAMP)")
    op.alter_column("notes", "last_synced_at", nullable=False)

    op.add_column("files", sa.Column("content_hash", sa.String(length=64), nullable=True))
    op.add_column("files", sa.Column("duration_seconds", sa.Integer(), nullable=True))
    op.create_index("ix_files_content_hash", "files", ["content_hash"], unique=False)

    op.create_table(
        "extracted_contents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_label", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="completed"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("note_id", "file_id", "source_type", name="uq_extracted_contents_note_file_source"),
    )
    op.create_index("ix_extracted_contents_note_id", "extracted_contents", ["note_id"], unique=False)
    op.create_index("ix_extracted_contents_file_id", "extracted_contents", ["file_id"], unique=False)
    op.create_index("ix_extracted_contents_user_id", "extracted_contents", ["user_id"], unique=False)
    op.create_index("ix_extracted_contents_source_type", "extracted_contents", ["source_type"], unique=False)
    op.create_index("ix_extracted_contents_content_hash", "extracted_contents", ["content_hash"], unique=False)
    op.create_index("ix_extracted_contents_status", "extracted_contents", ["status"], unique=False)

    op.create_table(
        "ai_response_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("question_hash", sa.String(length=64), nullable=False),
        sa.Column("context_hash", sa.String(length=64), nullable=False),
        sa.Column("encrypted_question", sa.Text(), nullable=True),
        sa.Column("encrypted_response", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "note_id",
            "user_id",
            "provider",
            "question_hash",
            "context_hash",
            name="uq_ai_response_cache_lookup",
        ),
    )
    op.create_index("ix_ai_response_cache_note_id", "ai_response_cache", ["note_id"], unique=False)
    op.create_index("ix_ai_response_cache_user_id", "ai_response_cache", ["user_id"], unique=False)
    op.create_index("ix_ai_response_cache_provider", "ai_response_cache", ["provider"], unique=False)
    op.create_index("ix_ai_response_cache_question_hash", "ai_response_cache", ["question_hash"], unique=False)
    op.create_index("ix_ai_response_cache_context_hash", "ai_response_cache", ["context_hash"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_response_cache_context_hash", table_name="ai_response_cache")
    op.drop_index("ix_ai_response_cache_question_hash", table_name="ai_response_cache")
    op.drop_index("ix_ai_response_cache_provider", table_name="ai_response_cache")
    op.drop_index("ix_ai_response_cache_user_id", table_name="ai_response_cache")
    op.drop_index("ix_ai_response_cache_note_id", table_name="ai_response_cache")
    op.drop_table("ai_response_cache")

    op.drop_index("ix_extracted_contents_status", table_name="extracted_contents")
    op.drop_index("ix_extracted_contents_content_hash", table_name="extracted_contents")
    op.drop_index("ix_extracted_contents_source_type", table_name="extracted_contents")
    op.drop_index("ix_extracted_contents_user_id", table_name="extracted_contents")
    op.drop_index("ix_extracted_contents_file_id", table_name="extracted_contents")
    op.drop_index("ix_extracted_contents_note_id", table_name="extracted_contents")
    op.drop_table("extracted_contents")

    op.drop_index("ix_files_content_hash", table_name="files")
    op.drop_column("files", "duration_seconds")
    op.drop_column("files", "content_hash")

    op.drop_column("notes", "last_synced_at")
