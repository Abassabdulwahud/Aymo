import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...config import get_settings
from ...utils.extraction.documents import extract_document_content
from ...utils.extraction.base import file_path_from_uploads_root

logger = logging.getLogger(__name__)


class DocumentProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        settings = get_settings()
        
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 10
        self.commit_and_sync(db, source)

        # 2. Extract Document content
        file_path = file_path_from_uploads_root(settings.uploads_dir, settings.uploads_base_url, source.public_url)
        if not file_path or not file_path.exists():
            err_msg = "The stored document file could not be found."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 30
        self.commit_and_sync(db, source)

        try:
            logger.info("Extracting content from document source %d", source.id)
            result = extract_document_content(file_path)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "Document extraction returned empty content.")
        except Exception as exc:
            err_msg = f"Document extraction failed: {exc}"
            logger.exception(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 50
        self.commit_and_sync(db, source)

        # 3. Chunk and store chunks
        logger.info("Chunking and storing chunks for document source %d", source.id)
        self.chunk_and_store_text_source(db, source, result.content, chunk_type="text")
        
        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 70
        self.commit_and_sync(db, source)

        # 4. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
