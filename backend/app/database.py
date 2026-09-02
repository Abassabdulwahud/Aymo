from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import get_settings

settings = get_settings()

database_url = settings.database_url or "sqlite:///:memory:"
engine_kwargs = {"pool_pre_ping": True}
if database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    from pathlib import Path
    import logging
    db_logger = logging.getLogger("aymo.database")
    # Strip sqlite:/// or sqlite:// prefix to get the filesystem path
    _prefix = "sqlite:////" if database_url.startswith("sqlite:////") else "sqlite:///"
    db_path_str = database_url[len(_prefix):]
    if db_path_str.startswith("/"):
        preferred_path = Path(db_path_str)
        parent_dir = preferred_path.parent
        if not parent_dir.exists():
            try:
                parent_dir.mkdir(parents=True, exist_ok=True)
                db_logger.info("Created parent directory for SQLite database: %s", parent_dir)
            except Exception as e:
                db_logger.warning(
                    "Could not create SQLite parent directory %s: %s — falling back to /tmp/aymo.db",
                    parent_dir, e
                )
                # Fallback: use writable temp directory so the service still starts
                database_url = "sqlite:////tmp/aymo.db"
        # Even if directory exists, verify it's writable before using it
        if database_url != "sqlite:////tmp/aymo.db":
            try:
                test_file = parent_dir / ".write_test"
                test_file.write_text("ok")
                test_file.unlink()
            except Exception as e:
                db_logger.warning(
                    "SQLite parent directory %s is not writable: %s — falling back to /tmp/aymo.db",
                    parent_dir, e
                )
                database_url = "sqlite:////tmp/aymo.db"
        db_logger.info("SQLite database path: %s", database_url)
else:
    engine_kwargs["pool_size"] = settings.database_pool_size
    engine_kwargs["max_overflow"] = settings.database_max_overflow

engine = create_engine(database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
