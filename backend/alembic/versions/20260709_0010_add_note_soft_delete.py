"""add note soft delete column

Revision ID: 20260709_0010
Revises: 20260701_0009
Create Date: 2026-07-09 11:42:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260709_0010"
down_revision: Union[str, None] = "20260701_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_notes_deleted_at"), "notes", ["deleted_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_notes_deleted_at"), table_name="notes")
    op.drop_column("notes", "deleted_at")
