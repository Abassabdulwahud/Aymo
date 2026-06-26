from pathlib import Path

import requests

from ...config import get_settings
from .base import ExtractionResult

settings = get_settings()


def extract_image_content(file_path: Path, file_url: str) -> ExtractionResult:
    if settings.vision_api_url and settings.vision_api_key:
        try:
            with file_path.open("rb") as handle:
                response = requests.post(
                    settings.vision_api_url,
                    headers={"Authorization": f"Bearer {settings.vision_api_key}"},
                    files={"image": handle},
                    timeout=30,
                )
            response.raise_for_status()
            payload = response.json()
            description = str(payload.get("description") or payload.get("caption") or "").strip()
            if description:
                return ExtractionResult(status="completed", content=description)
        except Exception as exc:
            return ExtractionResult(status="failed", content=None, error=f"Image vision analysis failed: {exc}")

    return ExtractionResult(
        status="completed",
        content=f"Image stored at {file_url}. Configure VISION_API_URL and VISION_API_KEY to enable automatic image description.",
    )
