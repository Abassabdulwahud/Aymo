"""normalize preferred language codes

Revision ID: 20260424_0005
Revises: 20260418_0004
Create Date: 2026-04-24 20:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260424_0005"
down_revision: Union[str, None] = "20260418_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE users
            SET preferred_language = CASE LOWER(TRIM(preferred_language))
                WHEN 'english' THEN 'en'
                WHEN 'en' THEN 'en'
                WHEN 'arabic' THEN 'ar'
                WHEN 'ar' THEN 'ar'
                WHEN 'french' THEN 'fr'
                WHEN 'fr' THEN 'fr'
                WHEN 'français' THEN 'fr'
                WHEN 'spanish' THEN 'es'
                WHEN 'es' THEN 'es'
                WHEN 'español' THEN 'es'
                WHEN 'german' THEN 'de'
                WHEN 'de' THEN 'de'
                WHEN 'deutsch' THEN 'de'
                ELSE 'en'
            END
            """
        )
        op.alter_column(
            "users",
            "preferred_language",
            existing_type=sa.String(length=50),
            type_=sa.String(length=10),
            existing_nullable=False,
            server_default="en",
        )
        return

    op.execute(
        """
        UPDATE users
        SET preferred_language = CASE LOWER(TRIM(preferred_language))
            WHEN 'english' THEN 'en'
            WHEN 'en' THEN 'en'
            WHEN 'arabic' THEN 'ar'
            WHEN 'ar' THEN 'ar'
            WHEN 'french' THEN 'fr'
            WHEN 'fr' THEN 'fr'
            WHEN 'français' THEN 'fr'
            WHEN 'spanish' THEN 'es'
            WHEN 'es' THEN 'es'
            WHEN 'español' THEN 'es'
            WHEN 'german' THEN 'de'
            WHEN 'de' THEN 'de'
            WHEN 'deutsch' THEN 'de'
            ELSE 'en'
        END
        """
    )
    op.alter_column(
        "users",
        "preferred_language",
        existing_type=sa.String(length=50),
        type_=sa.String(length=10),
        existing_nullable=False,
        server_default="en",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE users
            SET preferred_language = CASE preferred_language
                WHEN 'en' THEN 'English'
                WHEN 'ar' THEN 'Arabic'
                WHEN 'fr' THEN 'French'
                WHEN 'es' THEN 'Spanish'
                WHEN 'de' THEN 'German'
                ELSE 'English'
            END
            """
        )
    else:
        op.execute(
            """
            UPDATE users
            SET preferred_language = CASE preferred_language
                WHEN 'en' THEN 'English'
                WHEN 'ar' THEN 'Arabic'
                WHEN 'fr' THEN 'French'
                WHEN 'es' THEN 'Spanish'
                WHEN 'de' THEN 'German'
                ELSE 'English'
            END
            """
        )
    op.alter_column(
        "users",
        "preferred_language",
        existing_type=sa.String(length=10),
        type_=sa.String(length=50),
        existing_nullable=False,
        server_default="English",
    )
