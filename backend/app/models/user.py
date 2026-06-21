from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Enum as SqlEnum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .enums import AIProvider, ThemePreference


def _enum_values(enum_cls):
    return [member.value for member in enum_cls]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    profile_picture_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    preferred_ai_provider: Mapped[AIProvider] = mapped_column(
        SqlEnum(AIProvider, name="ai_provider_enum", values_callable=_enum_values),
        default=AIProvider.GEMINI,
        nullable=False,
    )
    preferred_theme: Mapped[ThemePreference] = mapped_column(
        SqlEnum(ThemePreference, name="theme_preference_enum", values_callable=_enum_values),
        default=ThemePreference.LIGHT,
        nullable=False,
    )
    preferred_language: Mapped[str] = mapped_column(String(50), default="English", nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="email", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    notes: Mapped[List["Note"]] = relationship("Note", back_populates="user", cascade="all, delete-orphan")
    tags: Mapped[List["Tag"]] = relationship("Tag", back_populates="user", cascade="all, delete-orphan")
    files: Mapped[List["File"]] = relationship("File", back_populates="user", cascade="all, delete-orphan")
