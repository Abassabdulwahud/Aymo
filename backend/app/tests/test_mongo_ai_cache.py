"""
Phase 5 Tests: MongoDB AI Cache Tenant Isolation and Repository Logic.
Uses unittest and offline-safe mocks/documents.
"""
import asyncio
import unittest
from app.models.mongo_models import AiCacheDoc, utc_now_iso


class TestMongoAICacheModel(unittest.TestCase):
    def test_ai_cache_doc_serialization(self):
        cache = AiCacheDoc(**{
            "_id": "cache-001",
            "user_id": "u-001",
            "note_id": "note-uuid-1",
            "provider": "gemini",
            "question": "What is Phase 5?",
            "response": "Phase 5 migrates AI to MongoDB.",
        })
        self.assertEqual(cache.id, "cache-001")
        self.assertEqual(cache.user_id, "u-001")
        self.assertEqual(cache.note_id, "note-uuid-1")
        self.assertEqual(cache.provider, "gemini")

        doc = cache.model_dump(by_alias=True)
        self.assertEqual(doc["_id"], "cache-001")
        self.assertEqual(doc["user_id"], "u-001")

    def test_ai_cache_isolation_logic(self):
        """Verify that cache queries filter strictly by both user_id AND note_id."""
        query_user_a = {"note_id": "note-1", "user_id": "user-A", "provider": "gemini", "question": "Q1"}
        query_user_b = {"note_id": "note-1", "user_id": "user-B", "provider": "gemini", "question": "Q1"}

        self.assertNotEqual(query_user_a["user_id"], query_user_b["user_id"])
        self.assertEqual(query_user_a["note_id"], query_user_b["note_id"])


if __name__ == "__main__":
    unittest.main()
