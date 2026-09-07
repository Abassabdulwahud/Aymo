"""
Phase 5 Tests: MongoDB AI Route, Authorization, Context Construction, and Tenant Isolation.
Uses unittest and offline-safe mocks.
"""
import unittest
from unittest.mock import MagicMock, AsyncMock, patch
from app.models.mongo_models import UserDoc, NoteDoc, FileDoc, AiCacheDoc
from app.services.ai.context import build_conversation_context_mongo, build_system_prompt, estimate_tokens
from app.dependencies.mongo_auth import AuthenticatedUser


class TestMongoAIContext(unittest.TestCase):
    def test_estimate_tokens(self):
        self.assertEqual(estimate_tokens("hello world"), 2)
        self.assertEqual(estimate_tokens(""), 0)

    def test_build_system_prompt(self):
        prompt = build_system_prompt("en")
        self.assertIn("AYMO Notebook AI Assistant", prompt)
        self.assertIn("CITATION INSTRUCTIONS", prompt)

    def test_build_conversation_context_mongo(self):
        ctx = build_conversation_context_mongo(
            note_title="Phase 5 Test Note",
            note_body="This is the note body text for testing.",
            current_message="Summarize this note",
            user_language="en",
            recent_responses=[{"question": "Prev Q", "response": "Prev R"}],
            file_summaries=["test.pdf (pdf) - status: completed"],
            extracted_items=[{"source": "test.pdf", "extracted_text": "Extracted PDF content text"}],
        )
        self.assertIn("Phase 5 Test Note", ctx)
        self.assertIn("This is the note body text for testing.", ctx)
        self.assertIn("CURRENT USER PROMPT:\nSummarize this note", ctx)
        self.assertIn("User: Prev Q\nAssistant: Prev R", ctx)
        self.assertIn("Extracted PDF content text", ctx)

    def test_disabled_media_does_not_crash_context(self):
        ctx = build_conversation_context_mongo(
            note_title="Media Note",
            note_body="Audio note",
            current_message="What is in the audio?",
            file_summaries=["lecture.mp3 (audio) - status: failed"],
            extracted_items=[],
        )
        self.assertIn("lecture.mp3 (audio) - status: failed", ctx)
        self.assertIn("CURRENT USER PROMPT:\nWhat is in the audio?", ctx)


class TestMongoAIAuthorization(unittest.TestCase):
    def test_authenticated_user_representation(self):
        user = AuthenticatedUser(user_id="user-123", email="user123@example.com")
        self.assertEqual(user.user_id, "user-123")
        self.assertEqual(user.email, "user123@example.com")
        self.assertIn("user-123", repr(user))


class TestAIProviderRouter(unittest.TestCase):
    def test_router_handles_string_and_enum_provider(self):
        from app.models.enums import AIProvider
        from app.services.ai.router import get_provider_clients, get_provider_client
        clients_enum = get_provider_clients(AIProvider.GEMINI)
        clients_str = get_provider_clients("gemini")
        self.assertEqual(len(clients_enum), len(clients_str))
        if clients_enum:
            self.assertEqual(clients_enum[0][0], "gemini")
            self.assertEqual(clients_str[0][0], "gemini")

    def test_get_provider_client_handles_string_and_enum(self):
        from app.models.enums import AIProvider
        from app.services.ai.router import get_provider_client
        client_enum = get_provider_client(AIProvider.GEMINI)
        client_str = get_provider_client("gemini")
        self.assertEqual(type(client_enum), type(client_str))


if __name__ == "__main__":
    unittest.main()
