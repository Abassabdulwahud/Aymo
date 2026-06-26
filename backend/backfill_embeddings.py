"""One-time backfill: generate embeddings for all READY sources that have chunks but no embeddings."""
import sys
import os

# Ensure the backend package is importable
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models.source import Source
from app.models.enums import SourceStatus
from app.models.note_embedding import NoteEmbedding
from app.services.embeddings import embed_source

db = SessionLocal()
try:
    all_sources = db.query(Source).filter(Source.status == SourceStatus.READY).all()
    print(f"Ready sources total: {len(all_sources)}")

    total_embedded = 0
    skipped = 0
    failed = 0

    for s in all_sources:
        embed_count = db.query(NoteEmbedding).filter(NoteEmbedding.source_id == s.id).count()
        chunk_count = len(s.chunks)

        if chunk_count == 0:
            print(f"  [SKIP] source {s.id} '{s.title[:35]}' — no chunks")
            skipped += 1
            continue

        if embed_count > 0:
            print(f"  [SKIP] source {s.id} '{s.title[:35]}' — already has {embed_count} embeddings")
            skipped += 1
            continue

        print(f"  [EMBED] source {s.id} [{s.source_type.value}] '{s.title[:40]}' ({chunk_count} chunks)...", end="", flush=True)
        try:
            err = embed_source(db, s)
            db.commit()
            new_count = db.query(NoteEmbedding).filter(NoteEmbedding.source_id == s.id).count()
            total_embedded += new_count
            print(f" -> {new_count} embeddings{'  WARNING: ' + err if err else ''}")
        except Exception as ex:
            db.rollback()
            print(f" -> FAILED: {ex}")
            failed += 1

    print(f"\nBackfill complete.")
    print(f"  Total new embeddings created: {total_embedded}")
    print(f"  Sources skipped: {skipped}")
    print(f"  Sources failed: {failed}")
finally:
    db.close()
