"""add_transcription_progress_columns

Revision ID: 20260608_0006
Revises: 0bb215e40ee2
Create Date: 2026-06-08 08:32:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260608_0006'
down_revision: Union[str, None] = '0bb215e40ee2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('files', sa.Column('processed_chunks', sa.Integer(), nullable=True))
    op.execute("UPDATE files SET processed_chunks = 0")
    op.alter_column('files', 'processed_chunks', nullable=False)

    op.add_column('files', sa.Column('total_chunks', sa.Integer(), nullable=True))
    op.execute("UPDATE files SET total_chunks = 0")
    op.alter_column('files', 'total_chunks', nullable=False)

    op.add_column('files', sa.Column('partial_transcript', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('files', 'partial_transcript')
    op.drop_column('files', 'total_chunks')
    op.drop_column('files', 'processed_chunks')
