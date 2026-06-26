from ...models.enums import SourceType
from .base import BaseSourceProcessor
from .pdf_processor import PdfProcessor
from .video_processor import VideoProcessor
from .audio_processor import AudioProcessor
from .link_processor import LinkProcessor
from .document_processor import DocumentProcessor
from .image_processor import ImageProcessor

_PROCESSORS = {
    SourceType.PDF: PdfProcessor(),
    SourceType.VIDEO: VideoProcessor(),
    SourceType.AUDIO: AudioProcessor(),
    SourceType.LINK: LinkProcessor(),
    SourceType.DOCUMENT: DocumentProcessor(),
    SourceType.IMAGE: ImageProcessor(),
}


def get_processor(source_type: SourceType) -> BaseSourceProcessor:
    processor = _PROCESSORS.get(source_type)
    if not processor:
        raise ValueError(f"No processor registered for source type: {source_type}")
    return processor
