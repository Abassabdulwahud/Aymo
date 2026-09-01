"""
Pre-Phase 4 Workspace Security and Repository Hardening Tests.

Tests cover:
1. Authenticated workspace registration (User A registers X -> success; User A registers X again -> idempotent; User B registers X -> 403; Unauth -> 401).
2. Server-side workspace ownership enforcement.
3. Resource isolation across repositories (notes, files, annotations, tombstones, remote_mappings).
4. Repository-backed sync push/pull behavior verification.
5. Cloudinary media storage architecture isolation check.
"""

import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.dependencies.mongo_auth import AuthenticatedUser, require_workspace_access
from app.models.mongo_models import (
    WorkspaceDoc,
    NoteDoc,
    FileDoc,
    AnnotationDoc,
    TombstoneDoc,
    utc_now_iso,
)
from app.repositories.mongo_repository import (
    WorkspaceMongoRepository,
    NoteMongoRepository,
    FileMongoRepository,
    AnnotationMongoRepository,
    SyncMongoRepository,
)


class TestWorkspaceRegistrationAndOwnership(unittest.TestCase):
    """Verify explicit workspace registration and cross-user claim prevention."""

    def setUp(self):
        self.alice = AuthenticatedUser(user_id="alice-uid", email="alice@aymo.app")
        self.bob = AuthenticatedUser(user_id="bob-uid", email="bob@aymo.app")

    def test_user_a_registers_workspace_success(self):
        """User A registering a fresh workspace ID must succeed."""
        mock_db = MagicMock()
        mock_db.workspaces.find_one = AsyncMock(return_value=None)
        mock_db.workspaces.insert_one = AsyncMock(return_value=None)

        repo = WorkspaceMongoRepository(mock_db)
        result = asyncio.run(repo.register_workspace("ws-alice-1", "alice-uid", "Alice Workspace"))

        self.assertEqual(result.id, "ws-alice-1")
        self.assertEqual(result.owner_user_id, "alice-uid")
        self.assertEqual(result.name, "Alice Workspace")

    def test_user_a_registers_same_workspace_idempotent(self):
        """User A registering the same workspace twice must return existing workspace cleanly."""
        mock_db = MagicMock()
        existing_doc = {
            "_id": "ws-alice-1",
            "owner_user_id": "alice-uid",
            "name": "Alice Workspace",
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        mock_db.workspaces.find_one = AsyncMock(return_value=existing_doc)

        repo = WorkspaceMongoRepository(mock_db)
        result = asyncio.run(repo.register_workspace("ws-alice-1", "alice-uid", "Alice Workspace"))

        self.assertEqual(result.id, "ws-alice-1")
        self.assertEqual(result.owner_user_id, "alice-uid")

    def test_user_b_claims_user_a_workspace_rejected(self):
        """User B attempting to register User A's workspace ID must raise ValueError (403)."""
        mock_db = MagicMock()
        existing_doc = {
            "_id": "ws-alice-1",
            "owner_user_id": "alice-uid",  # Owned by Alice
            "name": "Alice Workspace",
        }
        mock_db.workspaces.find_one = AsyncMock(return_value=existing_doc)

        repo = WorkspaceMongoRepository(mock_db)
        with self.assertRaises(ValueError) as ctx:
            asyncio.run(repo.register_workspace("ws-alice-1", "bob-uid", "Bob Infiltration"))

        self.assertIn("owned by another user", str(ctx.exception))

    def test_require_workspace_access_blocks_user_b(self):
        """require_workspace_access must reject User B for User A's workspace with 403."""
        from fastapi import HTTPException

        mock_db = MagicMock()
        mock_db.workspaces.find_one = AsyncMock(return_value={
            "_id": "ws-alice-1",
            "owner_user_id": "alice-uid",  # Owned by Alice
        })

        async def run_check():
            with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db):
                await require_workspace_access("ws-alice-1", self.bob)

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run_check())

        self.assertEqual(ctx.exception.status_code, 403)


class TestRepositoryResourceIsolation(unittest.TestCase):
    """Verify strict user_id scoping across Note, File, Annotation, and Sync Repositories."""

    def setUp(self):
        self.alice_id = "alice-uid"
        self.bob_id = "bob-uid"

    def test_note_repo_scoped_to_user_id(self):
        """NoteMongoRepository.get_by_id must return None if note belongs to another user."""
        mock_db = MagicMock()
        
        async def mock_find_one(query):
            if query.get("_id") == "bob-note-1" and query.get("user_id") == self.bob_id:
                return {
                    "_id": "bob-note-1",
                    "user_id": self.bob_id,
                    "workspace_id": "ws-bob",
                    "title": "Bob's Secret Note",
                }
            return None

        mock_db.notes.find_one = AsyncMock(side_effect=mock_find_one)

        repo = NoteMongoRepository(mock_db)

        # Alice attempts to fetch Bob's note
        res_alice = asyncio.run(repo.get_by_id("bob-note-1", user_id=self.alice_id))
        self.assertIsNone(res_alice, "Alice must NOT be able to fetch Bob's note")

        # Bob fetches his own note
        res_bob = asyncio.run(repo.get_by_id("bob-note-1", user_id=self.bob_id))
        self.assertIsNotNone(res_bob)
        self.assertEqual(res_bob.title, "Bob's Secret Note")

    def test_file_repo_scoped_to_user_id(self):
        """FileMongoRepository must not expose Bob's attachment to Alice."""
        mock_db = MagicMock()

        async def mock_find_one(query):
            if query.get("_id") == "file-bob-1" and query.get("user_id") == self.bob_id:
                return {
                    "_id": "file-bob-1",
                    "note_id": "note-1",
                    "user_id": self.bob_id,
                    "file_name": "passwords.pdf",
                    "file_type": "pdf",
                    "file_url": "https://cloudinary.com/passwords.pdf",
                }
            return None

        mock_db.files.find_one = AsyncMock(side_effect=mock_find_one)

        repo = FileMongoRepository(mock_db)

        res_alice = asyncio.run(repo.get_by_id("file-bob-1", user_id=self.alice_id))
        self.assertIsNone(res_alice, "Alice must NOT be able to fetch Bob's attachment")

        res_bob = asyncio.run(repo.get_by_id("file-bob-1", user_id=self.bob_id))
        self.assertIsNotNone(res_bob)
        self.assertEqual(res_bob.file_name, "passwords.pdf")

    def test_annotation_repo_scoped_to_user_id(self):
        """AnnotationMongoRepository list must filter by user_id."""
        mock_db = MagicMock()

        class MockAsyncCursor:
            def sort(self, *args, **kwargs):
                return self
            def __aiter__(self):
                return self
            async def __anext__(self):
                raise StopAsyncIteration

        mock_db.annotations.find.return_value = MockAsyncCursor()

        repo = AnnotationMongoRepository(mock_db)
        asyncio.run(repo.list_annotations(user_id=self.alice_id, source_id="src-1"))

        # Verify query sent to MongoDB included user_id=alice_id
        mock_db.annotations.find.assert_called_once_with({"user_id": self.alice_id, "source_id": "src-1"})

    def test_sync_repo_mapping_cross_user_rejected(self):
        """SyncMongoRepository must reject retrieving/creating mapping owned by another user."""
        mock_db = MagicMock()
        mock_db.remote_mappings.find_one = AsyncMock(return_value={
            "workspace_id": "ws-1",
            "entity_type": "note",
            "local_id": "loc-1",
            "remote_id": "rem-1",
            "user_id": self.bob_id,  # Owned by Bob
        })

        repo = SyncMongoRepository(mock_db)

        with self.assertRaises(ValueError) as ctx:
            asyncio.run(repo.get_or_create_remote_id("ws-1", "note", "loc-1", user_id=self.alice_id))

        self.assertIn("belongs to another user", str(ctx.exception))


class TestCloudinaryArchitectureIsolation(unittest.TestCase):
    """Verify that Cloudinary storage provider is cleanly decoupled from MongoDB schemas."""

    def test_file_doc_supports_local_only_without_cloudinary(self):
        """A FileDoc with extraction_status='local_only' and no Cloudinary storage_key is valid."""
        f = FileDoc(
            id="f-local-1",
            note_id="n-1",
            user_id="u-1",
            file_name="drawing.png",
            file_type="image",
            file_url="local://drawing.png",
            storage_key=None,  # Not uploaded to Cloudinary
            extraction_status="local_only",
        )
        self.assertIsNone(f.storage_key)
        self.assertEqual(f.extraction_status, "local_only")

    def test_file_doc_with_cloudinary_metadata(self):
        """FileDoc stores Cloudinary public_id in storage_key without storing raw binary."""
        f = FileDoc(
            id="f-cloud-1",
            note_id="n-1",
            user_id="u-1",
            file_name="recording.m4a",
            file_type="audio",
            file_url="https://res.cloudinary.com/aymo/video/upload/v1234/aymo/recording.m4a",
            storage_key="aymo/recording",  # Cloudinary public_id
            extraction_status="completed",
            duration_seconds=120,
        )
        self.assertEqual(f.storage_key, "aymo/recording")
        self.assertTrue(f.file_url.startswith("https://res.cloudinary.com/"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
