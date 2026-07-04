import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.enums import FileType
from ..models.file import File
from ..repositories.scoped_queries import file_for_user
from ..utils.extraction import extract_file_content
from ..utils.extraction.base import file_path_from_uploads_root
from .cache import cache_client
from .content_store import upsert_extracted_content


def get_file_or_none(db: Session, user_id: int, file_id: int) -> Optional[File]:
    return file_for_user(db, user_id, file_id).first()


def resolve_local_upload_path(file_record: File) -> Optional[Path]:
    settings = get_settings()
    if not file_record.file_url.startswith(settings.uploads_base_url):
        return None
    return file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, file_record.file_url)


def build_file_hash(file_record: File) -> str:
    local_path = resolve_local_upload_path(file_record)
    if local_path and local_path.exists():
        digest = hashlib.sha256()
        with local_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    stable_value = "{0}|{1}|{2}".format(file_record.file_name, file_record.file_url, file_record.file_size)
    return hashlib.sha256(stable_value.encode("utf-8")).hexdigest()


def _transcription_cache_key(file_hash: str) -> str:
    return "transcription:{0}".format(file_hash)





def extract_file_and_store(db: Session, file_record: File) -> str:
    import json
    file_hash = file_record.content_hash or build_file_hash(file_record)
    file_record.content_hash = file_hash

    is_media = file_record.file_type in {FileType.AUDIO, FileType.VIDEO}

    # Initialize progress for non-media files
    if not is_media:
        file_record.progress_percent = 20
        file_record.extraction_status = "processing"
        if file_record.detailed_steps:
            try:
                steps = json.loads(file_record.detailed_steps)
                for step in steps:
                    if "Extracting" in step["name"] or "Scraping" in step["name"]:
                        step["status"] = "processing"
                file_record.detailed_steps = json.dumps(steps)
            except Exception:
                pass
        db.add(file_record)
        db.commit()

    cached = cache_client.get_json(_transcription_cache_key(file_hash))
    if cached and cached.get("content"):
        content_text = cached["content"]
    else:
        result = extract_file_content(file_record)
        if result.status != "completed" or not result.content:
            # Handle failure progress
            if not is_media:
                file_record.progress_percent = 100
                file_record.extraction_status = "failed"
                file_record.extraction_error = result.error or "Could not extract file content."
                if file_record.detailed_steps:
                    try:
                        steps = json.loads(file_record.detailed_steps)
                        for step in steps:
                            if step["status"] == "processing":
                                step["status"] = "failed"
                        file_record.detailed_steps = json.dumps(steps)
                    except Exception:
                        pass
                db.add(file_record)
                db.commit()
            raise RuntimeError(result.error or "Could not extract file content.")
        content_text = result.content
        cache_client.set_json(
            _transcription_cache_key(file_hash),
            {"content": content_text},
            get_settings().transcription_cache_ttl_seconds,
        )

    # Transition progress to embedding for non-media files
    if not is_media:
        file_record.progress_percent = 70
        if file_record.detailed_steps:
            try:
                steps = json.loads(file_record.detailed_steps)
                for step in steps:
                    if "Extracting" in step["name"] or "Scraping" in step["name"]:
                        step["status"] = "completed"
                    if "Embeddings" in step["name"]:
                        step["status"] = "processing"
                file_record.detailed_steps = json.dumps(steps)
            except Exception:
                pass
        db.add(file_record)
        db.commit()

    source_type = {
        FileType.PDF: "pdf_text",
        FileType.DOCUMENT: "document_text",
        FileType.LINK: "link_text",
        FileType.IMAGE: "image_analysis",
    }.get(file_record.file_type, "file_text")
    upsert_extracted_content(
        db=db,
        note=file_record.note,
        user_id=file_record.user_id,
        source_type=source_type,
        source_label=file_record.file_name,
        content_text=content_text,
        file_record=file_record,
        source_url=file_record.file_url,
    )
    
    file_record.extracted_content = None
    file_record.extraction_status = "completed"
    file_record.extraction_error = None
    file_record.progress_percent = 100
    if file_record.detailed_steps:
        try:
            steps = json.loads(file_record.detailed_steps)
            for step in steps:
                step["status"] = "completed"
            file_record.detailed_steps = json.dumps(steps)
        except Exception:
            pass
    file_record.extracted_at = datetime.now(timezone.utc)
    db.add(file_record)
    return content_text
