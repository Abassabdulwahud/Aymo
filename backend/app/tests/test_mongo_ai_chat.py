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


class TestUnsyncedAINoteResolution(unittest.IsolatedAsyncioTestCase):
    async def test_unsynced_note_with_client_context_resolves_successfully(self):
        from app.routes.ai import resolve_note_for_ai, NoteContextPayload
        db = MagicMock()
        db.notes.find_one = AsyncMock(return_value=None)
        db.remote_mappings.find_one = AsyncMock(return_value=None)

        ctx = NoteContextPayload(title="ghijj", body="When I come home from school...")
        resolved = await resolve_note_for_ai(db, "7eeec648-8e5a-4344-bcf9-69d245dc24e5", "user-1", ctx)

        self.assertEqual(resolved.title, "ghijj")
        self.assertEqual(resolved.body, "When I come home from school...")
        self.assertIsNone(resolved.mongo_note_id)

    async def test_unsynced_note_without_context_raises_404(self):
        from app.routes.ai import resolve_note_for_ai
        from fastapi import HTTPException
        db = MagicMock()
        db.notes.find_one = AsyncMock(return_value=None)
        db.remote_mappings.find_one = AsyncMock(return_value=None)

        with self.assertRaises(HTTPException) as cm:
            await resolve_note_for_ai(db, "7eeec648-8e5a-4344-bcf9-69d245dc24e5", "user-1", None)
        self.assertEqual(cm.exception.status_code, 404)

    async def test_note_belonging_to_another_user_raises_403(self):
        from app.routes.ai import resolve_note_for_ai, NoteContextPayload
        from fastapi import HTTPException
        db = MagicMock()
        
        async def mock_find_one(query):
            if query.get("user_id") == "user-1":
                return None
            if query.get("_id") == "note-99":
                return {"_id": "note-99", "user_id": "user-2", "workspace_id": "ws-1"}
            return None

        db.notes.find_one = AsyncMock(side_effect=mock_find_one)

        ctx = NoteContextPayload(title="Sneaky Title", body="Sneaky Body")
        with self.assertRaises(HTTPException) as cm:
            await resolve_note_for_ai(db, "note-99", "user-1", ctx)
        self.assertEqual(cm.exception.status_code, 403)



    async def test_synced_note_prefers_client_edits(self):
        from app.routes.ai import resolve_note_for_ai, NoteContextPayload
        db = MagicMock()
        mock_mongo_note = MagicMock(id="note-1", title="Old Cloud Title", body="Old Cloud Body")

        with patch("app.routes.ai.NoteMongoRepository") as MockRepo:
            MockRepo.return_value.get_by_id = AsyncMock(return_value=mock_mongo_note)
            ctx = NoteContextPayload(title="New Local Title", body="New Local Body")
            resolved = await resolve_note_for_ai(db, "note-1", "user-1", ctx)

            self.assertEqual(resolved.title, "New Local Title")
            self.assertEqual(resolved.body, "New Local Body")
            self.assertEqual(resolved.mongo_note_id, "note-1")

    async def test_anonymous_note_context_resolves_without_db_lookup(self):
        from app.routes.ai import resolve_note_for_ai, NoteContextPayload
        db = MagicMock()
        db.notes.find_one = AsyncMock(return_value={"_id": "other-user-note", "user_id": "user-999"})

        ctx = NoteContextPayload(title="Anonymous Note", body="Local body content")
        resolved = await resolve_note_for_ai(db, "other-user-note", None, ctx)

        self.assertEqual(resolved.title, "Anonymous Note")
        self.assertEqual(resolved.body, "Local body content")
        self.assertIsNone(resolved.mongo_note_id)
        # Verify db.notes.find_one was NOT called for anonymous user
        db.notes.find_one.assert_not_called()

    async def test_anonymous_note_without_context_raises_400(self):
        from app.routes.ai import resolve_note_for_ai
        from fastapi import HTTPException
        db = MagicMock()

        with self.assertRaises(HTTPException) as cm:
            await resolve_note_for_ai(db, "any-note-id", None, None)
        self.assertEqual(cm.exception.status_code, 400)


class TestOptionalMongoUserDependency(unittest.IsolatedAsyncioTestCase):
    async def test_get_optional_mongo_user_returns_none_when_no_auth_header(self):
        from app.dependencies.mongo_auth import get_optional_mongo_user
        request = MagicMock()
        request.headers.get.return_value = ""

        user = await get_optional_mongo_user(request)
        self.assertIsNone(user)

    async def test_get_optional_mongo_user_raises_401_on_invalid_token(self):
        from app.dependencies.mongo_auth import get_optional_mongo_user
        from fastapi import HTTPException
        request = MagicMock()
        request.headers.get.return_value = "Bearer invalid.jwt.token"

        with self.assertRaises(HTTPException) as cm:
            await get_optional_mongo_user(request)
        self.assertEqual(cm.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()

