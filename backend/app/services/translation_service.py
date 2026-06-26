import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE_CODE = "en"
SUPPORTED_LANGUAGES = {
    "en": "English",
    "ar": "العربية",
    "fr": "Français",
    "es": "Español",
    "de": "Deutsch",
}
LANGUAGE_ALIASES = {
    "english": "en",
    "arabic": "ar",
    "العربية": "ar",
    "french": "fr",
    "francais": "fr",
    "français": "fr",
    "spanish": "es",
    "espanol": "es",
    "español": "es",
    "german": "de",
    "deutsch": "de",
}


@lru_cache(maxsize=1)
def _load_translation_map() -> Dict[str, Dict[str, str]]:
    locales_dir = Path(__file__).resolve().parents[2] / "locales"
    translations: Dict[str, Dict[str, str]] = {}
    for code in SUPPORTED_LANGUAGES:
        locale_path = locales_dir / "{0}.json".format(code)
        if not locale_path.exists():
            logger.warning("Translation file missing for language '%s': %s", code, locale_path)
            translations[code] = {}
            continue
        try:
            translations[code] = json.loads(locale_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Could not load translation file %s: %s", locale_path, exc)
            translations[code] = {}
    return translations


def initialize_translations() -> None:
    _load_translation_map()


def normalize_language_code(language_code: Optional[str]) -> str:
    value = (language_code or "").strip().lower()
    if not value:
        return DEFAULT_LANGUAGE_CODE
    if value in SUPPORTED_LANGUAGES:
        return value
    return LANGUAGE_ALIASES.get(value, DEFAULT_LANGUAGE_CODE)


def language_display_name(language_code: Optional[str]) -> str:
    normalized = normalize_language_code(language_code)
    return SUPPORTED_LANGUAGES.get(normalized, SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE_CODE])


def get_translation(language_code: Optional[str], key: str) -> str:
    normalized = normalize_language_code(language_code)
    translations = _load_translation_map()
    english = translations.get(DEFAULT_LANGUAGE_CODE, {})
    language_values = translations.get(normalized, {})
    return language_values.get(key) or english.get(key) or key


def translate(language_code: Optional[str], key: str) -> str:
    return get_translation(language_code, key)


def get_available_languages() -> List[Dict[str, str]]:
    return [{"code": code, "name": name} for code, name in SUPPORTED_LANGUAGES.items()]
