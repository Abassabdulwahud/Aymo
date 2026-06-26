"""add chunk metadata columns

Revision ID: 20260612_0008
Revises: 20260609_0007
Create Date: 2026-06-12 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260612_0008'
down_revision: Union[str, None] = '7d3682e5957e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add page_number to source_chunks
    op.add_column('source_chunks', sa.Column('page_number', sa.Integer(), nullable=True))

    # Add metadata_json to note_embeddings
    op.add_column('note_embeddings', sa.Column('metadata_json', sa.JSON(), nullable=True))


def downgrade() -> None:
    # Drop metadata_json from note_embeddings
    op.drop_column('note_embeddings', 'metadata_json')

    # Drop page_number from source_chunks
    op.drop_column('source_chunks', 'page_number')
