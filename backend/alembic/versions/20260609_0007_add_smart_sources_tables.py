"""add smart sources tables

Revision ID: 20260609_0007
Revises: 20260608_0006
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260609_0007'
down_revision: Union[str, None] = '20260608_0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


source_type_enum = sa.Enum("pdf", "video", "audio", "document", "link", "image", name="source_type_enum")
source_status_enum = sa.Enum("uploaded", "queued", "processing", "partially_ready", "ready", "failed", name="source_status_enum")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS source_type_enum CASCADE;")
        op.execute("DROP TYPE IF EXISTS source_status_enum CASCADE;")

    # Create sources table
    op.create_table(
        "sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("storage_path", sa.String(length=1024), nullable=True),
        sa.Column("public_url", sa.String(length=2048), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("status", source_status_enum, nullable=False, server_default="uploaded"),
        sa.Column("processing_progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("keywords", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sources_id", "sources", ["id"], unique=False)
    op.create_index("ix_sources_note_id", "sources", ["note_id"], unique=False)
    op.create_index("ix_sources_user_id", "sources", ["user_id"], unique=False)
    op.create_index("ix_sources_content_hash", "sources", ["content_hash"], unique=False)

    # Create source_chunks table
    op.create_table(
        "source_chunks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Float(), nullable=True),
        sa.Column("end_time", sa.Float(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_type", sa.String(length=50), nullable=False, server_default="text"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_source_chunks_id", "source_chunks", ["id"], unique=False)
    op.create_index("ix_source_chunks_source_id", "source_chunks", ["source_id"], unique=False)

    # Create source_summaries table
    op.create_table(
        "source_summaries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("topics", sa.JSON(), nullable=True),
        sa.Column("keywords", sa.JSON(), nullable=True),
        sa.Column("model_used", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_source_summaries_id", "source_summaries", ["id"], unique=False)
    op.create_index("ix_source_summaries_source_id", "source_summaries", ["source_id"], unique=False)

    # Add source_id to note_embeddings
    with op.batch_alter_table("note_embeddings") as batch_op:
        batch_op.add_column(sa.Column("source_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_note_embeddings_source_id_sources",
            "sources",
            ["source_id"],
            ["id"],
            ondelete="CASCADE",
        )
    op.create_index("ix_note_embeddings_source_id", "note_embeddings", ["source_id"], unique=False)

    # Back-fill files to sources
    # We do dialect-specific branches to handle strict Postgres enum type casting
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            INSERT INTO sources (
                id, note_id, user_id, source_type, title, original_filename,
                file_size, duration_seconds, mime_type, storage_path, public_url,
                content_hash, status, processing_progress, processing_error,
                summary, keywords, created_at, updated_at
            )
            SELECT
                id, note_id, user_id,
                CAST(file_type AS text)::source_type_enum AS source_type,
                file_name AS title,
                file_name AS original_filename,
                file_size,
                duration_seconds,
                NULL AS mime_type,
                NULL AS storage_path,
                file_url AS public_url,
                content_hash,
                (CASE
                    WHEN extraction_status = 'pending' THEN 'uploaded'
                    WHEN extraction_status = 'queued' THEN 'queued'
                    WHEN extraction_status = 'processing' THEN 'processing'
                    WHEN extraction_status = 'completed' THEN 'ready'
                    WHEN extraction_status = 'failed' THEN 'failed'
                    ELSE 'ready'
                END)::text::source_status_enum AS status,
                progress_percent AS processing_progress,
                extraction_error AS processing_error,
                viewer_notes AS summary,
                NULL AS keywords,
                uploaded_at AS created_at,
                uploaded_at AS updated_at
            FROM files
            """
        )
    else:
        op.execute(
            """
            INSERT INTO sources (
                id, note_id, user_id, source_type, title, original_filename,
                file_size, duration_seconds, mime_type, storage_path, public_url,
                content_hash, status, processing_progress, processing_error,
                summary, keywords, created_at, updated_at
            )
            SELECT
                id, note_id, user_id,
                file_type AS source_type,
                file_name AS title,
                file_name AS original_filename,
                file_size,
                duration_seconds,
                NULL AS mime_type,
                NULL AS storage_path,
                file_url AS public_url,
                content_hash,
                CASE
                    WHEN extraction_status = 'pending' THEN 'uploaded'
                    WHEN extraction_status = 'queued' THEN 'queued'
                    WHEN extraction_status = 'processing' THEN 'processing'
                    WHEN extraction_status = 'completed' THEN 'ready'
                    WHEN extraction_status = 'failed' THEN 'failed'
                    ELSE 'ready'
                END AS status,
                progress_percent AS processing_progress,
                extraction_error AS processing_error,
                viewer_notes AS summary,
                NULL AS keywords,
                uploaded_at AS created_at,
                uploaded_at AS updated_at
            FROM files
            """
        )

    # Sync sequence in Postgres if needed
    if bind.dialect.name == "postgresql":
        op.execute("SELECT setval(pg_get_serial_sequence('sources', 'id'), coalesce(max(id), 1)) FROM sources;")

    # Back-fill note_embeddings source_id
    op.execute("UPDATE note_embeddings SET source_id = file_id WHERE file_id IS NOT NULL")


def downgrade() -> None:
    # Drop source_id from note_embeddings using batch
    with op.batch_alter_table("note_embeddings") as batch_op:
        batch_op.drop_constraint("fk_note_embeddings_source_id_sources", type_="foreignkey")
        batch_op.drop_index("ix_note_embeddings_source_id")
        batch_op.drop_column("source_id")

    # Drop tables
    op.drop_index("ix_source_summaries_source_id", table_name="source_summaries")
    op.drop_index("ix_source_summaries_id", table_name="source_summaries")
    op.drop_table("source_summaries")

    op.drop_index("ix_source_chunks_source_id", table_name="source_chunks")
    op.drop_index("ix_source_chunks_id", table_name="source_chunks")
    op.drop_table("source_chunks")

    op.drop_index("ix_sources_content_hash", table_name="sources")
    op.drop_index("ix_sources_user_id", table_name="sources")
    op.drop_index("ix_sources_note_id", table_name="sources")
    op.drop_index("ix_sources_id", table_name="sources")
    op.drop_table("sources")

    bind = op.get_bind()
    source_status_enum.drop(bind, checkfirst=True)
    source_type_enum.drop(bind, checkfirst=True)
