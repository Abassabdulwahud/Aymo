import asyncio
import unittest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.services.task_orchestrator import (
    get_task_orchestrator,
    FastAPIBackgroundTasksOrchestrator,
    CeleryTaskOrchestrator,
)
from app.mongodb import is_mongo_available, init_mongodb, close_mongodb
from app.main import app

class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_settings_loaded(self):
        settings = get_settings()
        self.assertIsNotNone(settings.app_name)
        self.assertIn(settings.app_env, ["development", "production", "test"])
        self.assertIn(settings.task_orchestrator_provider, ["background_tasks", "celery"])
        self.assertIn(settings.file_storage_provider, ["local", "cloudinary"])

    def test_task_orchestrator_initialization(self):
        orchestrator = get_task_orchestrator()
        self.assertIsNotNone(orchestrator)
        self.assertIsInstance(orchestrator, (FastAPIBackgroundTasksOrchestrator, CeleryTaskOrchestrator))

    def test_fastapi_background_orchestrator_enqueue(self):
        orchestrator = FastAPIBackgroundTasksOrchestrator()
        called = False

        def sync_sample(param):
            nonlocal called
            called = True
            return param

        result = asyncio.run(orchestrator.enqueue("sample_sync", sync_sample, "test_param"))
        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["orchestrator"], "background_tasks")

    def test_mongodb_graceful_fallback(self):
        res = asyncio.run(init_mongodb())
        self.assertIsInstance(res, bool)
        asyncio.run(close_mongodb())

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("environment", data)
        self.assertIn("mongodb", data)
        self.assertIn("storage", data)
        self.assertIn("task_orchestrator", data)

if __name__ == "__main__":
    unittest.main()
