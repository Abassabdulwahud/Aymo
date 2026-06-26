import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...utils.extraction.links import extract_link_content

logger = logging.getLogger(__name__)


class LinkProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 10
        self.commit_and_sync(db, source)

        # 2. Extract link content
        if not source.public_url:
            err_msg = "No URL specified for link source."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 30
        self.commit_and_sync(db, source)

        try:
            logger.info("Scraping content from link source %d: %s", source.id, source.public_url)
            result = extract_link_content(source.public_url)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "Web scraping returned empty content.")
        except Exception as exc:
            err_msg = f"Web scraping failed: {exc}"
            logger.exception(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 50
        self.commit_and_sync(db, source)

        # 3. Chunk and store chunks
        logger.info("Chunking and storing chunks for link source %d", source.id)
        self.chunk_and_store_text_source(db, source, result.content, chunk_type="text")
        
        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 70
        self.commit_and_sync(db, source)

        # 4. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
