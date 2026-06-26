from typing import Iterable

from ...config import get_settings
from .base import AIProviderError, BaseAIProvider


class OpenAIProvider(BaseAIProvider):
    provider_name = "openai"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise AIProviderError("OpenAI is selected, but OPENAI_API_KEY is not configured.")
        self._api_key = settings.openai_api_key
        self._model = settings.openai_model

    def stream(self, system_prompt: str, user_prompt: str) -> Iterable[str]:
        response = self._safe_request(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": "Bearer {0}".format(self._api_key),
                "Content-Type": "application/json",
            },
            json={
                "model": self._model,
                "stream": True,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            stream=True,
        )
        for payload in self._iter_sse_json(response):
            choices = payload.get("choices") or []
            for choice in choices:
                delta = choice.get("delta") or {}
                text = delta.get("content") or ""
                if text:
                    yield text
