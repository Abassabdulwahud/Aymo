"""add annotations table

Revision ID: 20260717_0011
Revises: 7d3682e5957e
Create Date: 2026-07-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260717_0011'
down_revision: Union[str, None] = '20260709_0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'annotations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('page_number', sa.Integer(), nullable=True),
        sa.Column('selected_text', sa.Text(), nullable=False, server_default=''),
        sa.Column('bounding_rects', sa.JSON(), nullable=True),
        sa.Column('start_offset', sa.Integer(), nullable=True),
        sa.Column('end_offset', sa.Integer(), nullable=True),
        sa.Column('color', sa.String(length=32), nullable=False, server_default='#FFD60A'),
        sa.Column('annotation_type', sa.String(length=32), nullable=False, server_default='highlight'),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('linked_note_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_annotations_id', 'annotations', ['id'])
    op.create_index('ix_annotations_user_id', 'annotations', ['user_id'])
    op.create_index('ix_annotations_source_type', 'annotations', ['source_type'])
    op.create_index('ix_annotations_source_id', 'annotations', ['source_id'])
    op.create_index('ix_annotations_linked_note_id', 'annotations', ['linked_note_id'])


def downgrade() -> None:
    op.drop_index('ix_annotations_linked_note_id', table_name='annotations')
    op.drop_index('ix_annotations_source_id', table_name='annotations')
    op.drop_index('ix_annotations_source_type', table_name='annotations')
    op.drop_index('ix_annotations_user_id', table_name='annotations')
    op.drop_index('ix_annotations_id', table_name='annotations')
    op.drop_table('annotations')
