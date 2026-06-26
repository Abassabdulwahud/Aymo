import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models.extracted_content import ExtractedContent
from ..models.file import File
from ..models.note import Note
from .embeddings import replace_note_embeddings
from .encryption import decrypt_text, encrypt_text


def build_text_hash(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def get_decrypted_content(item: ExtractedContent) -> str:
    return decrypt_text(item.encrypted_content)


def upsert_extracted_content(
    db: Session,
    note: Note,
    user_id: int,
    source_type: str,
    source_label: str,
    content_text: str,
    file_record: Optional[File] = None,
    status: str = "completed",
    error: Optional[str] = None,
    source_url: Optional[str] = None,
) -> ExtractedContent:
    query = db.query(ExtractedContent).filter(
        ExtractedContent.note_id == note.id,
        ExtractedContent.source_type == source_type,
    )
    if file_record is not None:
        query = query.filter(ExtractedContent.file_id == file_record.id)
    else:
        query = query.filter(ExtractedContent.file_id.is_(None))

    item = query.first()
    if item is None:
        item = ExtractedContent(
            note_id=note.id,
            file_id=file_record.id if file_record else None,
            user_id=user_id,
            source_type=source_type,
            source_label=source_label,
        )

    item.source_url = source_url
    item.content_hash = build_text_hash(content_text)
    item.encrypted_content = encrypt_text(content_text)
    item.status = status
    item.error = error
    item.updated_at = datetime.now(timezone.utc)
    db.add(item)
    if status == "completed" and content_text:
        embedding_warning = replace_note_embeddings(
            db=db,
            note_id=note.id,
            content_text=content_text,
            file_id=file_record.id if file_record else None,
        )
        if embedding_warning:
            item.error = "{0} | {1}".format(item.error, embedding_warning) if item.error else embedding_warning
    return item
