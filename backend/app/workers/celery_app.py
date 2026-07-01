from celery import Celery

from ..config import get_settings

settings = get_settings()

broker_url = settings.celery_broker_url or settings.redis_url or "memory://"
result_backend = settings.celery_result_backend or settings.redis_url or "cache+memory://"
task_always_eager = settings.celery_task_always_eager or not settings.celery_broker_url

celery_app = Celery("aymo_notebook", broker=broker_url, backend=result_backend)
celery_app.conf.update(
    task_always_eager=task_always_eager,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_track_started=True,
    result_expires=3600,
    imports=["app.workers.tasks"],
)
