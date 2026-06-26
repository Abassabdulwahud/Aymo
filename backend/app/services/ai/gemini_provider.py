from typing import Iterable

from ...config import get_settings
from .base import AIProviderError, BaseAIProvider


class GeminiProvider(BaseAIProvider):
    provider_name = "gemini"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise AIProviderError("Google Gemini is selected, but GEMINI_API_KEY is not configured.")
        self._api_key = settings.gemini_api_key
        self._model = settings.gemini_model

    def stream(self, system_prompt: str, user_prompt: str) -> Iterable[str]:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/{0}:streamGenerateContent"
            "?alt=sse&key={1}"
        ).format(self._model, self._api_key)
        response = self._safe_request(
            "POST",
            url,
            headers={"Content-Type": "application/json"},
            json={
                "systemInstruction": {
                    "parts": [{"text": system_prompt}],
                },
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": user_prompt}],
                    }
                ],
            },
            stream=True,
        )
        for payload in self._iter_sse_json(response):
            candidates = payload.get("candidates") or []
            for candidate in candidates:
                content = candidate.get("content") or {}
                for part in content.get("parts") or []:
                    text = part.get("text") or ""
                    if text:
                        yield text
