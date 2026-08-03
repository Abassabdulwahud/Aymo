import re
import logging
from abc import ABC, abstractmethod
from sqlalchemy.orm import Session

from ...models.source import Source
from ...models.source_chunk import SourceChunk
from ...models.enums import SourceStatus
from ..embeddings import chunk_content, chunk_media_transcript, embed_source
from ..source_summary import summarize_source

logger = logging.getLogger(__name__)


class BaseSourceProcessor(ABC):
    @abstractmethod
    def process(self, source: Source, db: Session) -> None:
        """Run the full pipeline: extract → chunk → embed → summarize."""
        pass

    def chunk_and_store_text_source(self, db: Session, source: Source, content_text: str, chunk_type: str = "text") -> None:
        # First delete any existing chunks to avoid duplicates if reprocessing
        db.query(SourceChunk).filter(SourceChunk.source_id == source.id).delete()
        
        chunks = chunk_content(content_text)
        for index, chunk in enumerate(chunks):
            word_count = len(chunk.split())
            db.add(
                SourceChunk(
                    source_id=source.id,
                    chunk_index=index,
                    text=chunk,
                    word_count=word_count,
                    chunk_type=chunk_type,
                )
            )
        db.flush()

    def chunk_and_store_media_source(self, db: Session, source: Source, content_text: str) -> None:
        db.query(SourceChunk).filter(SourceChunk.source_id == source.id).delete()
        
        chunks = chunk_media_transcript(content_text)
        timestamp_range_pattern = re.compile(r"^\[(\d{2}):(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2})\]")
        
        for index, chunk in enumerate(chunks):
            start_time = None
            end_time = None
            
            match = timestamp_range_pattern.match(chunk)
            if match:
                h1, m1, s1, h2, m2, s2 = match.groups()
                start_time = float(int(h1) * 3600 + int(m1) * 60 + int(s1))
                end_time = float(int(h2) * 3600 + int(m2) * 60 + int(s2))
                
            word_count = len(chunk.split())
            db.add(
                SourceChunk(
                    source_id=source.id,
                    chunk_index=index,
                    start_time=start_time,
                    end_time=end_time,
                    text=chunk,
                    word_count=word_count,
                    chunk_type="transcript",
                )
            )
        db.flush()

    def _update_matching_file(self, db: Session, source: Source) -> None:
        from ...models.file import File
        file_record = db.query(File).filter(
            File.note_id == source.note_id,
            File.file_url == source.public_url
        ).first()
        if file_record:
            file_record.extraction_status = source.extraction_status
            file_record.progress_percent = source.processing_progress
            file_record.extraction_error = source.processing_error
            file_record.detailed_steps = source.detailed_steps
            file_record.processed_chunks = source.processed_chunks
            file_record.total_chunks = source.total_chunks
            file_record.partial_transcript = source.partial_transcript
            if source.duration_seconds is not None:
                file_record.duration_seconds = source.duration_seconds
            db.add(file_record)

    def commit_and_sync(self, db: Session, source: Source) -> None:
        db.add(source)
        self._update_matching_file(db, source)
        db.commit()

    def run_post_processing(self, db: Session, source: Source, content_text: str) -> None:
        try:
            # 1. Generate and save embeddings
            logger.info("Generating embeddings for source %d", source.id)
            embed_source(db, source)
            db.commit()
            
            # 2. Generate summary & keywords
            logger.info("Generating summary for source %d", source.id)
            summarize_source(db, source)
            db.commit()
            
            # 3. Transition to READY
            source.status = SourceStatus.READY
            source.processing_progress = 100
            self.commit_and_sync(db, source)
            logger.info("Successfully processed source %d", source.id)
            
        except Exception as exc:
            logger.exception("Failed post-processing for source %d: %s", source.id, exc)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = f"Post-processing failed: {exc}"
            try:
                self.commit_and_sync(db, source)
            except Exception as nested_exc:
                logger.error("Failed to commit failed state for source %d: %s", source.id, nested_exc)
            raise
