import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import get_settings
from .middleware.auth_middleware import AuthMiddleware
from .models import AIResponseCache, ExtractedContent, File, Note, Tag, User  # noqa: F401
from .routes.ai import router as ai_router
from .routes.ai import ws_router as ai_ws_router
from .routes.auth import router as auth_router
from .routes.content import router as content_router
from .routes.files import router as files_router
from .routes.sources import router as sources_router
from .routes.notes import router as notes_router
from .routes.protected import router as protected_router
from .routes.settings import router as settings_router
from .routes.tags import router as tags_router
from .services.embeddings import EMBEDDING_DIMENSION, EMBEDDING_MODEL_NAME, initialize_embedding_model
from .services.translation_service import initialize_translations

settings = get_settings()

app = FastAPI(title=settings.app_name)

app.add_middleware(AuthMiddleware)
# Always allow the Vercel production frontend.
# Additional origins can be added via the APP_ALLOWED_ORIGINS env var
# (comma-separated list of exact origins).
_HARDCODED_ORIGINS: list[str] = [
    "https://aymo-xi.vercel.app",
]
_extra_origins: list[str] = [
    o.strip()
    for o in os.getenv("APP_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"] + _HARDCODED_ORIGINS + _extra_origins,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(protected_router)
app.include_router(notes_router)
app.include_router(tags_router)
app.include_router(files_router)
app.include_router(sources_router)
app.include_router(content_router)
app.include_router(ai_router)
app.include_router(settings_router)
app.include_router(ai_ws_router)

project_root = Path(__file__).resolve().parents[2]
app.mount("/web", StaticFiles(directory=str(project_root)), name="web")
uploads_root = Path(settings.uploads_dir)
uploads_root.mkdir(parents=True, exist_ok=True)
app.mount(settings.uploads_base_url, StaticFiles(directory=str(uploads_root.resolve())), name="uploads")


@app.on_event("startup")
def warm_embedding_model():
    initialize_translations()
    initialize_embedding_model()
    app.state.embedding_model_name = EMBEDDING_MODEL_NAME
    app.state.embedding_dimension = EMBEDDING_DIMENSION


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}
