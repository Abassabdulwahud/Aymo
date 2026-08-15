from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import get_settings

settings = get_settings()

if not settings.database_url:
    raise RuntimeError("DATABASE_URL must be configured before starting the backend.")

database_url = settings.database_url
engine_kwargs = {"pool_pre_ping": True}
if database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    # Ensure parent directory exists for SQLite files (especially when using persistent disks like /data)
    from pathlib import Path
    import logging
    db_logger = logging.getLogger("aymo.database")
    db_path_str = database_url.replace("sqlite:///", "")
    if db_path_str.startswith("/"):
        parent_dir = Path(db_path_str).parent
        if not parent_dir.exists():
            try:
                parent_dir.mkdir(parents=True, exist_ok=True)
                db_logger.info("Created parent directory for SQLite database: %s", parent_dir)
            except Exception as e:
                db_logger.warning("Could not create SQLite parent directory %s: %s", parent_dir, e)
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
