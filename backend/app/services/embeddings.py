import logging
import math
import re
from functools import lru_cache
from typing import List, Optional, Sequence, Tuple

from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from ..models.note_embedding import NoteEmbedding
from ..models.file import File
from ..models.enums import FileType

logger = logging.getLogger(__name__)

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
LONG_TEXT_CHARACTER_THRESHOLD = 12000


def _embedding_table_missing(exc: Exception) -> bool:
    message = str(exc).lower()
    return "note_embeddings" in message and (
        "does not exist" in message or "no such table" in message or "undefinedtable" in message
    )


@lru_cache(maxsize=1)
def get_embedding_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBEDDING_MODEL_NAME)


def initialize_embedding_model() -> None:
    try:
        get_embedding_model()
        logger.info("Embedding model %s initialized.", EMBEDDING_MODEL_NAME)
    except Exception as exc:  # pragma: no cover - depends on local model/runtime availability
        logger.warning("Embedding model could not be initialized at startup: %s", exc)


def chunk_content(value: str) -> List[str]:
    paragraphs = [part.strip() for part in (value or "").split("\n\n")]
    paragraphs = [" ".join(part.split()) for part in paragraphs if part.strip()]
    if not paragraphs:
        return []

    chunks: List[str] = []
    carry = ""
    for paragraph in paragraphs:
        candidate = f"{carry}\n\n{paragraph}".strip() if carry else paragraph
        if len(candidate.split()) < 20:
            carry = candidate
            continue
        chunks.append(candidate)
        carry = ""

    if carry:
        if chunks:
            chunks[-1] = f"{chunks[-1]}\n\n{carry}".strip()
        else:
            chunks.append(carry)

    return chunks


def chunk_media_transcript(value: str) -> List[str]:
    # Regex to match timestamp at the start of a paragraph
    timestamp_pattern = re.compile(r"^\[(\d{2}):(\d{2}):(\d{2})\]")
    
    # Split the text by double newlines into paragraphs
    paragraphs = [p.strip() for p in (value or "").split("\n\n") if p.strip()]
    if not paragraphs:
        return []
        
    chunks: List[str] = []
    current_paragraphs: List[str] = []
    current_word_count = 0
    start_time_str = None
    end_time_str = None
    
    for p in paragraphs:
        match = timestamp_pattern.match(p)
        if match:
            h, m, s = match.groups()
            t_str = f"{h}:{m}:{s}"
            if start_time_str is None:
                start_time_str = t_str
            end_time_str = t_str
            
        p_word_count = len(p.split())
        
        # Group paragraphs into ~300 words
        if current_paragraphs and (current_word_count + p_word_count > 300):
            time_header = f"[{start_time_str} - {end_time_str}] " if start_time_str else ""
            chunks.append(time_header + "\n\n".join(current_paragraphs))
            
            current_paragraphs = [p]
            current_word_count = p_word_count
            if match:
                start_time_str = f"{h}:{m}:{s}"
                end_time_str = start_time_str
            else:
                start_time_str = None
                end_time_str = None
        else:
            current_paragraphs.append(p)
            current_word_count += p_word_count
            
    if current_paragraphs:
        time_header = f"[{start_time_str} - {end_time_str}] " if start_time_str else ""
        chunks.append(time_header + "\n\n".join(current_paragraphs))
        
    return chunks


def embed_texts(texts: Sequence[str]) -> List[List[float]]:
    if not texts:
        return []

    model = get_embedding_model()
    vectors = model.encode(list(texts), normalize_embeddings=True)
    return [list(map(float, vector)) for vector in vectors]


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return -1.0
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return -1.0
    return numerator / (left_norm * right_norm)


def replace_note_embeddings(
    db: Session,
    note_id: int,
    content_text: str,
    file_id: Optional[int] = None,
    source_id: Optional[int] = None,
    chunks_metadata: Optional[List[dict]] = None,
) -> Optional[str]:
    try:
        query = db.query(NoteEmbedding).filter(NoteEmbedding.note_id == note_id)
        if file_id is not None:
            query = query.filter(NoteEmbedding.file_id == file_id)
        elif source_id is not None:
            query = query.filter(NoteEmbedding.source_id == source_id)
        else:
            query = query.filter(NoteEmbedding.file_id.is_(None), NoteEmbedding.source_id.is_(None))
        query.delete(synchronize_session=False)
    except (OperationalError, ProgrammingError) as exc:
        if _embedding_table_missing(exc):
            logger.warning("Skipping embedding rebuild because note_embeddings table is missing.")
            db.rollback()
            return "Semantic search is unavailable until the latest database migration is applied."
        raise

    is_media = False
    if file_id:
        try:
            file_record = db.query(File).filter(File.id == file_id).first()
            if file_record and file_record.file_type in {FileType.AUDIO, FileType.VIDEO}:
                is_media = True
        except Exception as e:
            logger.warning("Failed to check file type for embedding: %s", e)

    if is_media:
        chunks = chunk_media_transcript(content_text)
    else:
        chunks = chunk_content(content_text)
    if not chunks:
        return None

    try:
        vectors = embed_texts(chunks)
    except Exception as exc:  # pragma: no cover - depends on local model/runtime availability
        logger.exception("Embedding generation failed for note %s file %s", note_id, file_id)
        return f"Embedding generation failed: {exc}"

    for index, (chunk, vector) in enumerate(zip(chunks, vectors)):
        meta = None
        if chunks_metadata and index < len(chunks_metadata):
            meta = chunks_metadata[index]
        elif file_id is None and source_id is None:
            meta = {"source_name": "Note content", "source_type": "note"}

        try:
            db.add(
                NoteEmbedding(
                    note_id=note_id,
                    file_id=file_id,
                    source_id=source_id,
                    content_chunk=chunk,
                    embedding_vector=vector,
                    chunk_order=index,
                    metadata_json=meta,
                )
            )
        except (OperationalError, ProgrammingError) as exc:
            if _embedding_table_missing(exc):
                logger.warning("Skipping embedding insert because note_embeddings table is missing.")
                db.rollback()
                return "Semantic search is unavailable until the latest database migration is applied."
            raise
    return None


def search_note_embeddings(
    db: Session,
    note_id: int,
    question: str,
    limit: int = 20,
    per_source_limit: int = 5,
) -> Tuple[List[Tuple[NoteEmbedding, float]], Optional[str]]:
    """Retrieve semantically relevant chunks from ALL sources attached to a note.

    The algorithm guarantees multi-source diversity:
    1. Fetch every NoteEmbedding for the note.
    2. Compute cosine similarity of every chunk against the question.
    3. Group chunks by their source key (source_id XOR file_id).
    4. From each group keep at most `per_source_limit` top-scoring chunks.
    5. Merge all groups and return the overall top `limit` chunks.

    This prevents a single high-volume source from crowding out all others.
    """
    try:
        embeddings = (
            db.query(NoteEmbedding)
            .filter(NoteEmbedding.note_id == note_id)
            .order_by(NoteEmbedding.chunk_order.asc(), NoteEmbedding.id.asc())
            .all()
        )
    except (OperationalError, ProgrammingError) as exc:
        if _embedding_table_missing(exc):
            logger.warning("Skipping semantic search because note_embeddings table is missing.")
            db.rollback()
            return [], "Semantic search is unavailable until the latest database migration is applied."
        raise
    if not embeddings:
        return [], None

    try:
        query_vector = embed_texts([question])[0]
    except Exception as exc:  # pragma: no cover - depends on local model/runtime availability
        logger.exception("Question embedding generation failed for note %s", note_id)
        return [], f"Embedding generation failed: {exc}"

    # Score every chunk
    scored: List[Tuple[NoteEmbedding, float]] = [
        (item, _cosine_similarity(query_vector, item.embedding_vector or []))
        for item in embeddings
    ]

    # Group by source key: prefer source_id, fall back to file_id, then None (note body)
    from collections import defaultdict
    groups: dict = defaultdict(list)
    for item, score in scored:
        if item.source_id is not None:
            key = ("source", item.source_id)
        elif item.file_id is not None:
            key = ("file", item.file_id)
        else:
            key = ("note", None)
        groups[key].append((item, score))

    # Keep top per_source_limit from each group
    diverse_pool: List[Tuple[NoteEmbedding, float]] = []
    for key, group_items in groups.items():
        group_items.sort(key=lambda pair: pair[1], reverse=True)
        diverse_pool.extend(group_items[:per_source_limit])

    # Re-rank the merged pool and return top limit
    diverse_pool.sort(key=lambda pair: pair[1], reverse=True)
    logger.debug(
        "search_note_embeddings: note=%s question=%r sources=%d total_chunks=%d pool=%d returning=%d",
        note_id, question[:60], len(groups), len(embeddings), len(diverse_pool), min(limit, len(diverse_pool)),
    )
    return diverse_pool[:limit], None


def format_timestamp(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    s = int(seconds)
    hours = s // 3600
    minutes = (s % 3600) // 60
    secs = s % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def embed_source(db: Session, source) -> Optional[str]:
    from ..models.source_chunk import SourceChunk
    try:
        db.query(NoteEmbedding).filter(
            NoteEmbedding.source_id == source.id,
        ).delete(synchronize_session=False)
    except (OperationalError, ProgrammingError) as exc:
        if _embedding_table_missing(exc):
            logger.warning("Skipping embedding rebuild because note_embeddings table is missing.")
            db.rollback()
            return "Semantic search is unavailable until the latest database migration is applied."
        raise

    chunks = sorted(source.chunks, key=lambda c: c.chunk_index)
    if not chunks:
        return None

    try:
        vectors = embed_texts([c.text for c in chunks])
    except Exception as exc:
        logger.exception("Embedding generation failed for source %s", source.id)
        return f"Embedding generation failed: {exc}"

    for chunk, vector in zip(chunks, vectors):
        meta = {
            "source_name": source.title,
            "source_type": source.source_type.value,
        }
        if chunk.chunk_type == "page" and getattr(chunk, "page_number", None) is not None:
            meta["page"] = chunk.page_number
        elif chunk.start_time is not None:
            meta["timestamp"] = format_timestamp(chunk.start_time)
        else:
            meta["paragraph"] = chunk.chunk_index + 1

        try:
            db.add(
                NoteEmbedding(
                    note_id=source.note_id,
                    source_id=source.id,
                    content_chunk=chunk.text,
                    embedding_vector=vector,
                    chunk_order=chunk.chunk_index,
                    metadata_json=meta,
                )
            )
        except (OperationalError, ProgrammingError) as exc:
            if _embedding_table_missing(exc):
                logger.warning("Skipping embedding insert because note_embeddings table is missing.")
                db.rollback()
                return "Semantic search is unavailable until the latest database migration is applied."
            raise
    return None


def search_source_embeddings(
    db: Session,
    source_id: int,
    question: str,
    limit: int = 5,
) -> Tuple[List[Tuple[NoteEmbedding, float]], Optional[str]]:
    try:
        embeddings = (
            db.query(NoteEmbedding)
            .filter(NoteEmbedding.source_id == source_id)
            .order_by(NoteEmbedding.chunk_order.asc(), NoteEmbedding.id.asc())
            .all()
        )
    except (OperationalError, ProgrammingError) as exc:
        if _embedding_table_missing(exc):
            logger.warning("Skipping semantic search because note_embeddings table is missing.")
            db.rollback()
            return [], "Semantic search is unavailable until the latest database migration is applied."
        raise
    if not embeddings:
        return [], None

    try:
        query_vector = embed_texts([question])[0]
    except Exception as exc:
        logger.exception("Question embedding generation failed for source %s", source_id)
        return [], f"Embedding generation failed: {exc}"

    ranked = sorted(
        ((item, _cosine_similarity(query_vector, item.embedding_vector or [])) for item in embeddings),
        key=lambda pair: pair[1],
        reverse=True,
    )
    return ranked[:limit], None

