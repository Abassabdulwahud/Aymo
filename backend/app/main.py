import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import get_settings
from .middleware.auth_middleware import AuthMiddleware
from .models import File, Note, Tag, User  # noqa: F401
from .routes.auth import router as auth_router
from .routes.notes import router as notes_router
from .routes.protected import router as protected_router
from .routes.tags import router as tags_router

settings = get_settings()

app = FastAPI(title=settings.app_name)


@app.on_event("startup")
def on_startup():
    """Run database migrations on startup using raw SQL for reliability."""
    import sys
    try:
        from sqlalchemy import text
        from .database import engine
        with engine.begin() as conn:
            # Create enums idempotently using PostgreSQL DO blocks
            conn.execute(text(
                "DO $$ BEGIN "
                "  CREATE TYPE ai_provider_enum AS ENUM ('gemini', 'openai', 'deepseek'); "
                "EXCEPTION WHEN duplicate_object THEN NULL; "
                "END $$;"
            ))
            conn.execute(text(
                "DO $$ BEGIN "
                "  CREATE TYPE theme_preference_enum AS ENUM ('light', 'dark'); "
                "EXCEPTION WHEN duplicate_object THEN NULL; "
                "END $$;"
            ))
            conn.execute(text(
                "DO $$ BEGIN "
                "  CREATE TYPE file_type_enum AS ENUM ('pdf', 'video', 'audio', 'document', 'link'); "
                "EXCEPTION WHEN duplicate_object THEN NULL; "
                "END $$;"
            ))

            # Create core tables using IF NOT EXISTS
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    full_name VARCHAR(255),
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password_hash VARCHAR(255),
                    profile_picture_url VARCHAR(2048),
                    preferred_ai_provider ai_provider_enum NOT NULL DEFAULT 'gemini',
                    preferred_theme theme_preference_enum NOT NULL DEFAULT 'light',
                    preferred_language VARCHAR(50) NOT NULL DEFAULT 'English',
                    provider VARCHAR(50) NOT NULL DEFAULT 'email',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS ix_users_id ON users (id);
                CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS notes (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
                    is_favorited BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS ix_notes_id ON notes (id);
                CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes (user_id);
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS tags (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(80) NOT NULL,
                    CONSTRAINT uq_tags_user_id_name UNIQUE (user_id, name)
                );
                CREATE INDEX IF NOT EXISTS ix_tags_id ON tags (id);
                CREATE INDEX IF NOT EXISTS ix_tags_user_id ON tags (user_id);
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS files (
                    id SERIAL PRIMARY KEY,
                    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    file_name VARCHAR(255) NOT NULL,
                    file_type file_type_enum NOT NULL,
                    file_url VARCHAR(2048) NOT NULL,
                    file_size BIGINT NOT NULL DEFAULT 0,
                    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS ix_files_id ON files (id);
                CREATE INDEX IF NOT EXISTS ix_files_note_id ON files (note_id);
                CREATE INDEX IF NOT EXISTS ix_files_user_id ON files (user_id);
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS note_tags (
                    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (note_id, tag_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ix_note_tags_note_id_tag_id ON note_tags (note_id, tag_id);
            """))

            # Stamp alembic_version so Alembic knows migration 0001 has been applied
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS alembic_version (
                    version_num VARCHAR(32) NOT NULL,
                    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
                );
            """))
            existing = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
            if not existing:
                conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('20260329_0001')"))

        print("Database schema initialised successfully.", file=sys.stdout)
    except Exception as e:
        print(f"Database startup error: {e}", file=sys.stderr)


# Allow localhost in development, plus any origins set via APP_ALLOWED_ORIGINS
# (comma-separated, e.g. https://aymo-frontend.onrender.com)
_extra_origins: list[str] = [
    o.strip()
    for o in os.getenv("APP_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"] + _extra_origins,
    # Allow local dev ports without having to re-patch CORS each time.
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router)
app.include_router(protected_router)
app.include_router(notes_router)
app.include_router(tags_router)

# Serve local preview files through the same backend origin to avoid CORS issues.
project_root = Path(__file__).resolve().parents[2]
app.mount("/web", StaticFiles(directory=str(project_root)), name="web")


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}


@app.get("/db-inspect")
def db_inspect():
    try:
        from sqlalchemy import inspect, text
        from .database import engine
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        alembic_version = None
        if "alembic_version" in tables:
            with engine.connect() as conn:
                res = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
                if res:
                    alembic_version = res[0]

        return {
            "tables": tables,
            "alembic_version": alembic_version,
            "database_url_host": engine.url.host,
            "database_url_database": engine.url.database
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/db-user")
def db_user(email: str):
    """Debug endpoint: show password_hash stored for given email."""
    try:
        from sqlalchemy import text
        from .database import engine
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT id, email, password_hash, provider FROM users WHERE email = :e"),
                {"e": email.lower()}
            ).fetchone()
        if not row:
            return {"found": False}
        return {
            "found": True,
            "id": row[0],
            "email": row[1],
            "password_hash_prefix": (row[2] or "")[:10] if row[2] else None,
            "password_hash_length": len(row[2]) if row[2] else 0,
            "provider": row[3],
        }
    except Exception as e:
        return {"error": str(e)}

