"""add file extraction columns

Revision ID: 20260406_0002
Revises: 20260329_0001
Create Date: 2026-04-06 01:15:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260406_0002"
down_revision: Union[str, None] = "20260329_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE file_type_enum ADD VALUE IF NOT EXISTS 'image'")
    op.add_column("files", sa.Column("extracted_content", sa.Text(), nullable=True))
    op.add_column("files", sa.Column("extraction_status", sa.String(length=50), nullable=False, server_default="pending"))
    op.add_column("files", sa.Column("extraction_error", sa.Text(), nullable=True))
    op.add_column("files", sa.Column("viewer_notes", sa.Text(), nullable=True))
    op.add_column("files", sa.Column("extracted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("files", "extracted_at")
    op.drop_column("files", "viewer_notes")
    op.drop_column("files", "extraction_error")
    op.drop_column("files", "extraction_status")
    op.drop_column("files", "extracted_content")
