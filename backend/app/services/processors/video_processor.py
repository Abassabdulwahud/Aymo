import logging
from sqlalchemy.orm import Session
from .base import BaseSourceProcessor
from ...models.source import Source
from ...models.enums import SourceStatus

logger = logging.getLogger(__name__)


class VideoProcessor(BaseSourceProcessor):
    """
    No-op processor for video files.

    AI video analysis is not yet available.  The file is stored and accessible
    for playback, but no frame extraction, transcription, or embedding is
    performed.  The source is immediately marked READY so the upload flow
    completes cleanly.
    """

    def process(self, source: Source, db: Session) -> None:
        logger.info(
            "VideoProcessor: AI video analysis not yet available — marking source %d READY without extraction.",
            source.id,
        )
        source.status = SourceStatus.READY
        source.processing_progress = 100
        self.commit_and_sync(db, source)
