import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from .audio_processor import _SourceFileAdapter
from ...models.source import Source
from ...models.enums import SourceStatus
from ...utils.extraction.media import extract_video_content
from ...utils.extraction.base import resolve_file_for_extraction

logger = logging.getLogger(__name__)


class VideoProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 5
        self.commit_and_sync(db, source)

        # 2. Resolve file path
        file_path, is_temp = resolve_file_for_extraction(source.public_url, source.storage_key)
        if not file_path or not file_path.exists():
            err_msg = "The stored video file could not be found."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        # 3. Resolve the matching File record — extract_video_content requires a File object
        #    for session-backed progress tracking (processed_chunks, total_chunks, etc.)
        from ...models.file import File
        file_record = db.query(File).filter(
            File.note_id == source.note_id,
            File.file_url == source.public_url,
        ).first()

        if file_record is None:
            # No matching File exists (upload went via the Sources API directly).
            file_record = _SourceFileAdapter(source, db)

        try:
            logger.info("Transcribing video source %d", source.id)
            result = extract_video_content(str(file_path), file_record)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "Video transcription returned empty content.")
        except Exception as exc:
            err_msg = f"Video transcription failed: {exc}"
            logger.exception(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return
        finally:
            if is_temp and file_path and file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    pass

        # 4. Chunk and store chunks
        logger.info("Chunking and storing chunks for video source %d", source.id)
        self.chunk_and_store_media_source(db, source, result.content)

        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 90
        self.commit_and_sync(db, source)

        # 5. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
