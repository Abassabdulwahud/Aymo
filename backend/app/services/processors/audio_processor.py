import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...config import get_settings
from ...utils.extraction.media import extract_audio_content
from ...utils.extraction.base import resolve_file_for_extraction

logger = logging.getLogger(__name__)


class AudioProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        settings = get_settings()
        
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 5
        self.commit_and_sync(db, source)

        # 2. Resolve file path
        file_path, is_temp = resolve_file_for_extraction(source.public_url, source.storage_key)
        if not file_path or not file_path.exists():
            err_msg = "The stored audio file could not be found."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        try:
            logger.info("Transcribing audio source %d", source.id)
            result = extract_audio_content(str(file_path), source)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "Audio transcription returned empty content.")
        except Exception as exc:
            err_msg = f"Audio transcription failed: {exc}"
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

        # 3. Chunk and store chunks
        logger.info("Chunking and storing chunks for audio source %d", source.id)
        self.chunk_and_store_media_source(db, source, result.content)
        
        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 90
        self.commit_and_sync(db, source)

        # 4. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
