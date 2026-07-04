import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus

logger = logging.getLogger(__name__)


class AudioProcessor(BaseSourceProcessor):
    """
    No-op processor for audio files.

    AI transcription for audio is not yet available.  The file is stored and
    accessible for playback, but no transcription, chunking, or embedding is
    performed.  The source is immediately marked READY so the upload flow
    completes cleanly.
    """

    def process(self, source: Source, db: Session) -> None:
        logger.info(
            "AudioProcessor: AI transcription not yet available — marking source %d READY without extraction.",
            source.id,
        )
        source.status = SourceStatus.READY
        source.processing_progress = 100
        self.commit_and_sync(db, source)
