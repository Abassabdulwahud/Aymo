import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...config import get_settings
from ...utils.extraction.pdfs import extract_pdf_content
from ...utils.extraction.base import resolve_file_for_extraction

logger = logging.getLogger(__name__)


class PdfProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
        from ...models.source_chunk import SourceChunk
        from ...services.embeddings import chunk_content
        settings = get_settings()
        
        # 1. Update status to PROCESSING
        source.status = SourceStatus.PROCESSING
        source.processing_progress = 10
        self.commit_and_sync(db, source)

        # 2. Extract PDF content
        file_path, is_temp = resolve_file_for_extraction(source.public_url, source.storage_key)
        if not file_path or not file_path.exists():
            err_msg = "The stored PDF file could not be found."
            logger.error(err_msg)
            source.status = SourceStatus.FAILED
            source.processing_progress = 100
            source.processing_error = err_msg
            self.commit_and_sync(db, source)
            return

        source.processing_progress = 30
        self.commit_and_sync(db, source)

        try:
            logger.info("Extracting content from PDF source %d", source.id)
            result = extract_pdf_content(file_path)
            if result.status != "completed" or not result.content:
                raise RuntimeError(result.error or "PDF extraction returned empty content.")
        except Exception as exc:
            err_msg = f"PDF extraction failed: {exc}"
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

        # 3. Chunk and store chunks page-by-page
        logger.info("Chunking and storing chunks for PDF source %d", source.id)
        db.query(SourceChunk).filter(SourceChunk.source_id == source.id).delete()
        
        pages = (result.metadata or {}).get("pages", [])
        chunk_idx = 0
        for page_idx, page_text in enumerate(pages):
            page_num = page_idx + 1
            page_chunks = chunk_content(page_text)
            for chunk in page_chunks:
                word_count = len(chunk.split())
                db.add(
                    SourceChunk(
                        source_id=source.id,
                        chunk_index=chunk_idx,
                        text=chunk,
                        word_count=word_count,
                        chunk_type="page",
                        page_number=page_num,
                    )
                )
                chunk_idx += 1
        db.flush()
        
        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 70
        self.commit_and_sync(db, source)

        # 4. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)
