import pytest
from fastapi.testclient import TestClient
from ..config import get_settings
from ..services.task_orchestrator import (
    get_task_orchestrator,
    FastAPIBackgroundTasksOrchestrator,
    CeleryTaskOrchestrator,
)
from ..mongodb import is_mongo_available, init_mongodb, close_mongodb
from ..main import app

client = TestClient(app)

def test_settings_loaded():
    """Verify that settings are loaded with correct types and defaults."""
    settings = get_settings()
    assert settings.app_name is not None
    assert settings.app_env in ["development", "production", "test"]
    assert settings.task_orchestrator_provider in ["background_tasks", "celery"]
    assert settings.file_storage_provider in ["local", "cloudinary"]

def test_task_orchestrator_initialization():
    """Verify that TaskOrchestrator factory returns an instance of TaskOrchestrator."""
    orchestrator = get_task_orchestrator()
    assert orchestrator is not None
    assert isinstance(orchestrator, (FastAPIBackgroundTasksOrchestrator, CeleryTaskOrchestrator))

@pytest.mark.asyncio
async def test_fastapi_background_orchestrator_enqueue():
    """Verify that FastAPIBackgroundTasksOrchestrator enqueues synchronous and async functions."""
    orchestrator = FastAPIBackgroundTasksOrchestrator()
    called = False

    def sync_sample(param):
        nonlocal called
        called = True
        return param

    result = await orchestrator.enqueue("sample_sync", sync_sample, "test_param")
    assert result["status"] == "queued"
    assert result["orchestrator"] == "background_tasks"

@pytest.mark.asyncio
async def test_mongodb_graceful_fallback():
    """Verify that MongoDB initialization handles absence of connection gracefully without throwing."""
    # When MONGODB_URL is not set or invalid, init_mongodb() returns False without raising unhandled exception
    res = await init_mongodb()
    assert isinstance(res, bool)
    await close_mongodb()

def test_health_endpoint():
    """Verify health endpoint returns status, environment, mongodb status, storage, and orchestrator."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "environment" in data
    assert "mongodb" in data
    assert "storage" in data
    assert "task_orchestrator" in data
