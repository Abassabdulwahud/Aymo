from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class ExtractionResult:
    status: str
    content: Optional[str]
    error: Optional[str] = None
    metadata: Optional[dict] = None


def file_path_from_uploads_root(uploads_dir: str, uploads_base_url: str, file_url: str) -> Optional[Path]:
    if not file_url.startswith(uploads_base_url):
        return None

    relative_path = file_url[len(uploads_base_url):].strip("/")
    if not relative_path:
        return None

    return Path(uploads_dir).resolve() / Path(relative_path)
