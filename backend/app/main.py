import os
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
import traceback
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
    try:
        from alembic.config import Config
        from alembic import command
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
        print("Database migrations applied successfully.")
    except Exception as e:
        import sys
        print(f"Failed to run migrations: {e}", file=sys.stderr)


@app.exception_handler(Exception)
async def debug_exception_handler(request, exc):
    tbl = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return PlainTextResponse(tbl, status_code=500)

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
    migration_error = None
    migration_success = False
    try:
        from alembic.config import Config
        from alembic import command
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
        migration_success = True
    except Exception as e:
        migration_error = str(e)

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
            "migration_success": migration_success,
            "migration_error": migration_error,
            "tables": tables,
            "alembic_version": alembic_version,
            "database_url_schema": engine.url.drivername,
            "database_url_host": engine.url.host,
            "database_url_database": engine.url.database
        }
    except Exception as e:
        return {
            "migration_success": migration_success,
            "migration_error": migration_error,
            "error": str(e)
        }
