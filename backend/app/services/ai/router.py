from typing import List, Tuple, Union

from ...config import get_settings
from ...models.enums import AIProvider
from .base import AIProviderError
from .deepseek_provider import DeepSeekProvider
from .gemini_provider import GeminiProvider
from .openai_provider import OpenAIProvider


def get_provider_client(provider: Union[AIProvider, str]):
    if isinstance(provider, str):
        try:
            provider = AIProvider(provider.lower().strip())
        except ValueError:
            provider = AIProvider.GEMINI

    if provider == AIProvider.OPENAI:
        return OpenAIProvider()
    if provider == AIProvider.DEEPSEEK:
        return DeepSeekProvider()
    return GeminiProvider()


def get_provider_clients(preferred_provider: Union[AIProvider, str]) -> List[Tuple[str, object]]:
    if isinstance(preferred_provider, str):
        try:
            preferred_enum = AIProvider(preferred_provider.lower().strip())
        except ValueError:
            preferred_enum = AIProvider.GEMINI
    else:
        preferred_enum = preferred_provider

    settings = get_settings()
    configured = {
        AIProvider.GEMINI: bool(settings.gemini_api_key),
        AIProvider.OPENAI: bool(settings.openai_api_key),
        AIProvider.DEEPSEEK: bool(settings.deepseek_api_key),
    }

    if configured.get(preferred_enum):
        try:
            return [(preferred_enum.value, get_provider_client(preferred_enum))]
        except AIProviderError:
            pass

    clients: List[Tuple[str, object]] = []
    for provider in (AIProvider.GEMINI, AIProvider.OPENAI, AIProvider.DEEPSEEK):
        if provider == preferred_enum or not configured.get(provider):
            continue
        try:
            clients.append((provider.value, get_provider_client(provider)))
        except AIProviderError:
            continue
    return clients


__all__ = ["AIProviderError", "get_provider_client", "get_provider_clients"]
