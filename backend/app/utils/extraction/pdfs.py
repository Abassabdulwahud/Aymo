from pathlib import Path
import shutil

import fitz
import pytesseract
from PIL import Image

from ...config import get_settings
from .base import ExtractionResult

settings = get_settings()


def _can_run_tesseract() -> bool:
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
        return True
    return shutil.which("tesseract") is not None


def extract_pdf_content(file_path: Path) -> ExtractionResult:
    ocr_available = _can_run_tesseract()

    try:
        document = fitz.open(file_path)
    except Exception as exc:
        return ExtractionResult(status="failed", content=None, error=f"Could not open PDF: {exc}")

    extracted_chunks = []
    skipped_ocr_pages = 0
    try:
        for page in document:
            page_text = page.get_text("text").strip()
            if page_text:
                extracted_chunks.append(page_text)
                continue

            if not ocr_available:
                skipped_ocr_pages += 1
                continue

            pixmap = page.get_pixmap(dpi=180)
            image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
            try:
                ocr_text = pytesseract.image_to_string(image).strip()
            except Exception as exc:
                skipped_ocr_pages += 1
                continue
            if ocr_text:
                extracted_chunks.append(ocr_text)
    finally:
        document.close()

    if not extracted_chunks:
        if not ocr_available:
            return ExtractionResult(
                status="failed",
                content=None,
                error="No text could be extracted from this PDF. If it is scanned or image-based, configure Tesseract OCR.",
            )
        return ExtractionResult(status="failed", content=None, error="No text could be extracted from this PDF.")

    warning = None
    if skipped_ocr_pages:
        warning = (
            "Some PDF pages could not be OCR processed, but text was extracted from the remaining pages."
        )

    return ExtractionResult(
        status="completed",
        content="\n\n".join(extracted_chunks),
        error=warning,
        metadata={"pages": extracted_chunks},
    )
