import json
from typing import Dict, Generator, Iterable, List, Optional

import requests


class AIProviderError(RuntimeError):
    pass


class BaseAIProvider:
    provider_name = "base"

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        chunks: List[str] = []
        for chunk in self.stream(system_prompt, user_prompt):
            chunks.append(chunk)
        return "".join(chunks).strip()

    def stream(self, system_prompt: str, user_prompt: str) -> Iterable[str]:
        raise NotImplementedError

    @staticmethod
    def _iter_sse_json(response: requests.Response) -> Generator[Dict, None, None]:
        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            line = raw_line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                continue

    @staticmethod
    def _safe_request(method: str, url: str, **kwargs) -> requests.Response:
        try:
            response = requests.request(method, url, timeout=60, **kwargs)
        except requests.RequestException as exc:
            raise AIProviderError("The AI provider could not be reached right now. Please try again.") from exc

        if response.status_code >= 400:
            detail = response.text.strip()
            if not detail:
                detail = "The AI provider returned an unexpected error."
            raise AIProviderError(detail[:500])
        response.encoding = "utf-8"
        return response
