import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...config import get_settings
from ...utils.extraction.images import extract_image_content
from ...utils.extraction.base import resolve_file_for_extraction

logger = logging.getLogger(__name__)


class ImageProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        settings = get_settings()
        
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 10
        self.commit_and_sync(db, source)

        # 2. Extract Image content
        file_path, is_temp = resolve_file_for_extraction(source.public_url, source.storage_key)
        if not file_path or not file_path.exists():
            err_msg = "The stored image file could not be found."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 30
        self.commit_and_sync(db, source)

        try:
            logger.info("Extracting content from image source %d", source.id)
            result = extract_image_content(file_path, source.public_url)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "Image extraction returned empty content.")
        except Exception as exc:
            err_msg = f"Image extraction failed: {exc}"
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

        source.processing_progress = 50
        self.commit_and_sync(db, source)

        # 3. Chunk and store chunks
        logger.info("Chunking and storing chunks for image source %d", source.id)
        self.chunk_and_store_text_source(db, source, result.content, chunk_type="ocr")
        
        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 70
        self.commit_and_sync(db, source)

        # 4. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
