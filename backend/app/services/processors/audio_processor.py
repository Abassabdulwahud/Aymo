import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus
from ...utils.extraction.media import extract_audio_content
from ...utils.extraction.base import resolve_file_for_extraction

logger = logging.getLogger(__name__)


class AudioProcessor(BaseSourceProcessor):
    def process(self, source: Source, db: Session) -> None:
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

        # 3. Resolve the matching File record — extract_audio_content requires a File object
        #    for session-backed progress tracking (processed_chunks, total_chunks, etc.)
        from ...models.file import File
        file_record = db.query(File).filter(
            File.note_id == source.note_id,
            File.file_url == source.public_url,
        ).first()

        if file_record is None:
            # No matching File exists (upload went via the Sources API directly).
            # Fall back to a thin adapter so media.py can still track progress.
            file_record = _SourceFileAdapter(source, db)

        try:
            logger.info("Transcribing audio source %d", source.id)
            result = extract_audio_content(str(file_path), file_record)
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

        # 4. Chunk and store chunks
        logger.info("Chunking and storing chunks for audio source %d", source.id)
        self.chunk_and_store_media_source(db, source, result.content)

        # Transition to PARTIALLY_READY
        source.status = SourceStatus.PARTIALLY_READY
        source.processing_progress = 90
        self.commit_and_sync(db, source)

        # 5. Post-processing (embeddings + summary)
        self.run_post_processing(db, source, result.content)


class _SourceFileAdapter:
    """
    Thin shim that wraps a Source to look like a File for the media.py pipeline.

    media.py's process_media_file() accesses:
        - file_record.processed_chunks  (int, resumption state)
        - file_record.total_chunks      (int)
        - file_record.partial_transcript (str | None)
        - file_record.progress_percent  (setter)
        - file_record.extraction_status (setter)
        - file_record.extraction_error  (setter)
        - file_record.detailed_steps    (setter)
        - object_session(file_record)   → db session

    All writes are forwarded to the underlying Source and committed immediately.
    """

    def __init__(self, source: Source, db: Session) -> None:
        self._source = source
        self._db = db
        self.id = source.id  # used in log messages inside media.py

    # --- read-only scalars forwarded from Source (Redis-backed) ---
    @property
    def processed_chunks(self) -> int:
        return self._source.processed_chunks

    @property
    def total_chunks(self) -> int:
        return self._source.total_chunks

    @property
    def partial_transcript(self):
        return self._source.partial_transcript

    # --- write properties forwarded to Source + committed ---
    @processed_chunks.setter
    def processed_chunks(self, value: int) -> None:
        self._source.processed_chunks = value

    @total_chunks.setter
    def total_chunks(self, value: int) -> None:
        self._source.total_chunks = value

    @partial_transcript.setter
    def partial_transcript(self, value) -> None:
        self._source.partial_transcript = value

    @property
    def progress_percent(self) -> int:
        return self._source.processing_progress

    @progress_percent.setter
    def progress_percent(self, value: int) -> None:
        self._source.processing_progress = value
        try:
            self._db.add(self._source)
            self._db.commit()
        except Exception:
            pass

    @property
    def extraction_status(self) -> str:
        return self._source.extraction_status

    @extraction_status.setter
    def extraction_status(self, value: str) -> None:
        self._source.extraction_status = value  # uses Source's property setter

    @property
    def extraction_error(self):
        return self._source.processing_error

    @extraction_error.setter
    def extraction_error(self, value) -> None:
        self._source.processing_error = value

    @property
    def detailed_steps(self):
        return self._source.detailed_steps

    @detailed_steps.setter
    def detailed_steps(self, value) -> None:
        self._source.detailed_steps = value

    def __eq__(self, other):
        return self is other
