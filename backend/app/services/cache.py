import json
import threading
import time
from typing import Any, Dict, Optional

from ..config import get_settings

try:
    import redis
except ImportError:  # pragma: no cover - dependency may be optional at install time
    redis = None


class InMemoryCache:
    def __init__(self) -> None:
        self._store: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            expires_at, value = item
            if expires_at and expires_at < time.time():
                self._store.pop(key, None)
                return None
            return value

    def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        expires_at = time.time() + ttl_seconds if ttl_seconds > 0 else None
        with self._lock:
            self._store[key] = (expires_at, value)


class CacheClient:
    def __init__(self) -> None:
        self._memory = InMemoryCache()
        self._redis = self._build_redis_client()

    def _build_redis_client(self):
        settings = get_settings()
        if not settings.redis_url or redis is None:
            return None
        try:
            return redis.Redis.from_url(settings.redis_url, decode_responses=True)
        except Exception:
            return None

    def get_json(self, key: str) -> Optional[dict]:
        raw_value = None
        if self._redis is not None:
            try:
                raw_value = self._redis.get(key)
            except Exception:
                raw_value = None

        if raw_value is None:
            raw_value = self._memory.get(key)

        if raw_value is None:
            return None

        try:
            return json.loads(raw_value)
        except json.JSONDecodeError:
            return None

    def set_json(self, key: str, value: dict, ttl_seconds: int) -> None:
        raw_value = json.dumps(value)
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl_seconds, raw_value)
            except Exception:
                pass
        self._memory.setex(key, ttl_seconds, raw_value)


cache_client = CacheClient()
