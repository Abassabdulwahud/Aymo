"""add storage provider fields to files and sources

Revision ID: 20260701_0009
Revises: 7d3682e5957e
Create Date: 2026-07-01 00:00:00.000000

Adds three nullable columns to both `files` and `sources` tables:
    storage_provider  — which provider stored this file ("local" | "cloudinary")
    storage_key       — provider-specific asset key (e.g. Cloudinary public_id)
    cdn_url           — the CDN delivery URL (redundant with public_url for Cloudinary;
                        kept separate so the original public_url field is never mutated)

Existing rows are left as-is (all columns NULL = legacy local behaviour).
Only new uploads will have these columns populated.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260701_0009"
down_revision: Union[str, None] = "20260612_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- files table ---
    with op.batch_alter_table("files") as batch_op:
        batch_op.add_column(sa.Column("storage_provider", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("storage_key", sa.String(length=1024), nullable=True))
        batch_op.add_column(sa.Column("cdn_url", sa.String(length=2048), nullable=True))

    # --- sources table ---
    with op.batch_alter_table("sources") as batch_op:
        batch_op.add_column(sa.Column("storage_provider", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("storage_key", sa.String(length=1024), nullable=True))
        batch_op.add_column(sa.Column("cdn_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sources") as batch_op:
        batch_op.drop_column("cdn_url")
        batch_op.drop_column("storage_key")
        batch_op.drop_column("storage_provider")

    with op.batch_alter_table("files") as batch_op:
        batch_op.drop_column("cdn_url")
        batch_op.drop_column("storage_key")
        batch_op.drop_column("storage_provider")
