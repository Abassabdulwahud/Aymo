"""create core tables

Revision ID: 20260329_0001
Revises:
Create Date: 2026-03-29 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260329_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ai_provider_enum = sa.Enum("gemini", "openai", "deepseek", name="ai_provider_enum")
theme_preference_enum = sa.Enum("light", "dark", name="theme_preference_enum")
file_type_enum = sa.Enum("pdf", "video", "audio", "document", "link", name="file_type_enum")


def upgrade() -> None:
    bind = op.get_bind()
    try:
        ai_provider_enum.create(bind, checkfirst=True)
    except Exception:
        pass
    try:
        theme_preference_enum.create(bind, checkfirst=True)
    except Exception:
        pass
    try:
        file_type_enum.create(bind, checkfirst=True)
    except Exception:
        pass

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("profile_picture_url", sa.String(length=2048), nullable=True),
        sa.Column("preferred_ai_provider", ai_provider_enum, nullable=False, server_default="gemini"),
        sa.Column("preferred_theme", theme_preference_enum, nullable=False, server_default="light"),
        sa.Column("preferred_language", sa.String(length=50), nullable=False, server_default="English"),
        sa.Column("provider", sa.String(length=50), nullable=False, server_default="email"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_favorited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notes_id", "notes", ["id"], unique=False)
    op.create_index("ix_notes_user_id", "notes", ["user_id"], unique=False)

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_tags_user_id_name"),
    )
    op.create_index("ix_tags_id", "tags", ["id"], unique=False)
    op.create_index("ix_tags_user_id", "tags", ["user_id"], unique=False)

    op.create_table(
        "files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", file_type_enum, nullable=False),
        sa.Column("file_url", sa.String(length=2048), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_files_id", "files", ["id"], unique=False)
    op.create_index("ix_files_note_id", "files", ["note_id"], unique=False)
    op.create_index("ix_files_user_id", "files", ["user_id"], unique=False)

    op.create_table(
        "note_tags",
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "tag_id"),
    )
    op.create_index("ix_note_tags_note_id_tag_id", "note_tags", ["note_id", "tag_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_note_tags_note_id_tag_id", table_name="note_tags")
    op.drop_table("note_tags")

    op.drop_index("ix_files_user_id", table_name="files")
    op.drop_index("ix_files_note_id", table_name="files")
    op.drop_index("ix_files_id", table_name="files")
    op.drop_table("files")

    op.drop_index("ix_tags_user_id", table_name="tags")
    op.drop_index("ix_tags_id", table_name="tags")
    op.drop_table("tags")

    op.drop_index("ix_notes_user_id", table_name="notes")
    op.drop_index("ix_notes_id", table_name="notes")
    op.drop_table("notes")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    file_type_enum.drop(bind, checkfirst=True)
    theme_preference_enum.drop(bind, checkfirst=True)
    ai_provider_enum.drop(bind, checkfirst=True)
