from bs4 import BeautifulSoup
import requests

from .base import ExtractionResult


def extract_link_content(url: str) -> ExtractionResult:
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "AYMO Notebook Extractor/1.0"},
            timeout=15,
        )
        response.raise_for_status()
    except Exception as exc:
        return ExtractionResult(status="failed", content=None, error=f"Could not fetch webpage content: {exc}")

    soup = BeautifulSoup(response.content, "html.parser")

    for element in soup(["script", "style", "noscript", "header", "footer"]):
        element.decompose()

    text = " ".join(chunk.strip() for chunk in soup.stripped_strings if chunk.strip())
    if not text:
        return ExtractionResult(status="failed", content=None, error="The webpage did not expose readable text content.")

    return ExtractionResult(status="completed", content=text[:20000])
