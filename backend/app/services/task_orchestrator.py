import logging
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Optional
from ..config import get_settings

logger = logging.getLogger("aymo.task_orchestrator")

class TaskOrchestrator(ABC):
    """
    Abstract interface for background and asynchronous durable task execution.
    Allows AYMO to switch between lightweight FastAPI background execution and
    durable Celery/Redis worker queues without refactoring endpoints.
    """

    @abstractmethod
    async def enqueue(
        self,
        task_name: str,
        func: Callable[..., Any],
        *args: Any,
        **kwargs: Any
    ) -> Dict[str, Any]:
        """
        Enqueues a generic background job.
        Returns a dictionary with task status and metadata.
        """
        pass

    @abstractmethod
    async def enqueue_pdf_extraction(self, file_id: str, user_id: str) -> Dict[str, Any]:
        """Enqueues PDF text and structure extraction."""
        pass

    @abstractmethod
    async def enqueue_link_scrape(self, file_id: str, user_id: str) -> Dict[str, Any]:
        """Enqueues web link scraping and markdown extraction."""
        pass

    @abstractmethod
    async def enqueue_transcription(self, file_id: str, user_id: str) -> Dict[str, Any]:
        """Enqueues audio/video transcription."""
        pass


class FastAPIBackgroundTasksOrchestrator(TaskOrchestrator):
    """
    In-process async background task runner.
    Lightweight, requires zero external infrastructure (no Redis or Celery needed).
    Ideal for development and standard cloud hosting.
    """

    def __init__(self) -> None:
        logger.info("Initialized FastAPIBackgroundTasksOrchestrator (in-process)")

    async def enqueue(
        self,
        task_name: str,
        func: Callable[..., Any],
        *args: Any,
        **kwargs: Any
    ) -> Dict[str, Any]:
        import asyncio
        logger.info(f"[BackgroundTasks] Scheduling task '{task_name}'")
        try:
            if asyncio.iscoroutinefunction(func):
                asyncio.create_task(func(*args, **kwargs))
            else:
                asyncio.create_task(asyncio.to_thread(func, *args, **kwargs))
            return {"status": "queued", "orchestrator": "background_tasks", "task_name": task_name}
        except Exception as e:
            logger.error(f"Failed to enqueue task '{task_name}': {e}", exc_info=True)
            return {"status": "failed", "error": str(e), "task_name": task_name}

    async def enqueue_pdf_extraction(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[BackgroundTasks] Enqueueing PDF extraction for file_id={file_id}, user_id={user_id}")
        # Note: Handlers are plugged in during extraction service phases
        return {"status": "queued", "file_id": file_id, "type": "pdf_extraction", "orchestrator": "background_tasks"}

    async def enqueue_link_scrape(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[BackgroundTasks] Enqueueing link scrape for file_id={file_id}, user_id={user_id}")
        return {"status": "queued", "file_id": file_id, "type": "link_scrape", "orchestrator": "background_tasks"}

    async def enqueue_transcription(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[BackgroundTasks] Enqueueing transcription for file_id={file_id}, user_id={user_id}")
        return {"status": "queued", "file_id": file_id, "type": "transcription", "orchestrator": "background_tasks"}


class CeleryTaskOrchestrator(TaskOrchestrator):
    """
    Durable distributed task runner via Celery + Redis.
    Used when durable retries, isolation, and dedicated worker processes are configured.
    """

    def __init__(self) -> None:
        logger.info("Initialized CeleryTaskOrchestrator (distributed queue)")

    async def enqueue(
        self,
        task_name: str,
        func: Callable[..., Any],
        *args: Any,
        **kwargs: Any
    ) -> Dict[str, Any]:
        logger.info(f"[Celery] Dispatching task '{task_name}'")
        try:
            # If celery task is wrapped
            if hasattr(func, "delay"):
                async_res = func.delay(*args, **kwargs)
                return {"status": "queued", "task_id": async_res.id, "orchestrator": "celery", "task_name": task_name}
            else:
                import asyncio
                asyncio.create_task(asyncio.to_thread(func, *args, **kwargs))
                return {"status": "queued", "orchestrator": "celery_fallback", "task_name": task_name}
        except Exception as e:
            logger.error(f"[Celery] Error dispatching task '{task_name}': {e}", exc_info=True)
            return {"status": "failed", "error": str(e), "task_name": task_name}

    async def enqueue_pdf_extraction(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[Celery] Dispatching PDF extraction for file_id={file_id}")
        return {"status": "queued", "file_id": file_id, "type": "pdf_extraction", "orchestrator": "celery"}

    async def enqueue_link_scrape(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[Celery] Dispatching link scrape for file_id={file_id}")
        return {"status": "queued", "file_id": file_id, "type": "link_scrape", "orchestrator": "celery"}

    async def enqueue_transcription(self, file_id: str, user_id: str) -> Dict[str, Any]:
        logger.info(f"[Celery] Dispatching transcription for file_id={file_id}")
        return {"status": "queued", "file_id": file_id, "type": "transcription", "orchestrator": "celery"}


_orchestrator_instance: Optional[TaskOrchestrator] = None

def get_task_orchestrator() -> TaskOrchestrator:
    """
    Factory that returns the configured TaskOrchestrator instance.
    Defaults to FastAPIBackgroundTasksOrchestrator if Celery is not explicitly requested.
    """
    global _orchestrator_instance
    if _orchestrator_instance is not None:
        return _orchestrator_instance

    settings = get_settings()
    provider = getattr(settings, "task_orchestrator_provider", "background_tasks").lower()

    if provider == "celery" and getattr(settings, "celery_broker_url", None):
        _orchestrator_instance = CeleryTaskOrchestrator()
    else:
        _orchestrator_instance = FastAPIBackgroundTasksOrchestrator()

    return _orchestrator_instance
