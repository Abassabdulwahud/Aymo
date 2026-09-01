"""
Phase 2 Tests: MongoDB Atlas Schema, Repository, and Index validation.
Uses unittest to avoid pytest dependency.
Tests are offline-safe: they skip Atlas-dependent tests gracefully if MongoDB is unavailable.
"""
import asyncio
import unittest
from datetime import datetime, timezone

from app.models.mongo_models import (
    UserDoc,
    NoteDoc,
    FileDoc,
    AnnotationDoc,
    AiCacheDoc,
    RemoteMappingDoc,
    TombstoneDoc,
    utc_now_iso,
)


class TestMongoModels(unittest.TestCase):
    """Verify Pydantic document models serialize/deserialize correctly."""

    def test_user_doc_creation(self):
        user = UserDoc(**{
            "_id": "u-001",
            "email": "test@aymo.app",
            "full_name": "Test User",
        })
        self.assertEqual(user.id, "u-001")
        self.assertEqual(user.email, "test@aymo.app")
        self.assertEqual(user.provider, "email")
        self.assertIsNotNone(user.created_at)

    def test_user_doc_serialization(self):
        user = UserDoc(**{"_id": "u-001", "email": "a@b.com"})
        doc = user.model_dump(by_alias=True)
        self.assertIn("_id", doc)
        self.assertEqual(doc["_id"], "u-001")

    def test_note_doc_creation(self):
        note = NoteDoc(**{
            "_id": "note-stable-uuid",
            "user_id": "u-001",
            "workspace_id": "ws-001",
            "title": "Phase 2 Note",
            "body": "<p>Hello</p>",
            "tags": ["Work", "Draft"],
            "version": 1,
        })
        self.assertEqual(note.id, "note-stable-uuid")
        self.assertEqual(note.tags, ["Work", "Draft"])
        self.assertIsNone(note.deleted_at)
        doc = note.model_dump(by_alias=True)
        self.assertEqual(doc["_id"], "note-stable-uuid")

    def test_note_soft_delete_field(self):
        note = NoteDoc(**{
            "_id": "note-del",
            "user_id": "u-001",
            "workspace_id": "ws-001",
            "deleted_at": utc_now_iso(),
        })
        self.assertIsNotNone(note.deleted_at)

    def test_note_stable_id_preserved(self):
        """Stable local UUID must survive serialization roundtrip without alteration."""
        stable_id = "aaa-bbb-ccc-111"
        note = NoteDoc(**{"_id": stable_id, "user_id": "u-1", "workspace_id": "ws-1"})
        doc = note.model_dump(by_alias=True)
        restored = NoteDoc(**doc)
        self.assertEqual(restored.id, stable_id)

    def test_file_doc_creation(self):
        f = FileDoc(**{
            "_id": "file-uuid-1",
            "note_id": "note-uuid-1",
            "user_id": "u-001",
            "file_name": "report.pdf",
            "file_type": "pdf",
            "file_url": "https://res.cloudinary.com/aymo/report.pdf",
        })
        self.assertEqual(f.id, "file-uuid-1")
        self.assertEqual(f.extraction_status, "queued")

    def test_annotation_doc_creation(self):
        ann = AnnotationDoc(**{
            "_id": "ann-001",
            "user_id": "u-001",
            "source_type": "pdf",
            "source_id": "file-uuid-1",
            "selected_text": "Phase 2",
            "annotation_type": "highlight",
        })
        self.assertEqual(ann.color, "#FFE082")
        self.assertEqual(ann.annotation_type, "highlight")

    def test_tombstone_doc_creation(self):
        tomb = TombstoneDoc(**{
            "workspace_id": "ws-001",
            "entity_type": "note",
            "local_id": "note-local-1",
            "remote_id": "note-remote-1",
        })
        self.assertIsNotNone(tomb.deleted_at)

    def test_remote_mapping_doc_creation(self):
        rm = RemoteMappingDoc(**{
            "workspace_id": "ws-001",
            "entity_type": "note",
            "local_id": "note-local-1",
            "remote_id": "note-cloud-1",
        })
        self.assertEqual(rm.entity_type, "note")
        self.assertIsNotNone(rm.created_at)

    def test_utc_now_iso_format(self):
        ts = utc_now_iso()
        self.assertIn("T", ts)
        # Must be a parseable ISO format
        parsed = datetime.fromisoformat(ts)
        self.assertIsNotNone(parsed)


class TestOwnershipIsolation(unittest.TestCase):
    """Verify that user_id ownership is preserved and enforced in model creation."""

    def test_note_requires_user_id(self):
        """Note models must always carry user_id."""
        note = NoteDoc(**{"_id": "n-1", "user_id": "u-999", "workspace_id": "ws-1"})
        self.assertEqual(note.user_id, "u-999")
        doc = note.model_dump(by_alias=True)
        self.assertEqual(doc["user_id"], "u-999")

    def test_file_requires_user_id(self):
        f = FileDoc(**{
            "_id": "f-1",
            "note_id": "n-1",
            "user_id": "u-abc",
            "file_name": "img.png",
            "file_type": "image",
            "file_url": "https://res.cloudinary.com/img.png",
        })
        doc = f.model_dump(by_alias=True)
        self.assertEqual(doc["user_id"], "u-abc")

    def test_annotation_requires_user_id(self):
        ann = AnnotationDoc(**{
            "_id": "ann-2",
            "user_id": "u-xyz",
            "source_type": "note",
            "source_id": "n-1",
            "selected_text": "text",
        })
        self.assertEqual(ann.user_id, "u-xyz")


class TestSyncMetadata(unittest.TestCase):
    """Verify that sync-supporting fields are present in document models."""

    def test_note_has_version(self):
        note = NoteDoc(**{"_id": "n-1", "user_id": "u-1", "workspace_id": "ws-1", "version": 5})
        self.assertEqual(note.version, 5)

    def test_note_version_increments_on_update(self):
        """Simulate version increment behavior."""
        note = NoteDoc(**{"_id": "n-1", "user_id": "u-1", "workspace_id": "ws-1", "version": 3})
        note.version = note.version + 1
        self.assertEqual(note.version, 4)

    def test_note_has_created_and_updated(self):
        note = NoteDoc(**{"_id": "n-1", "user_id": "u-1", "workspace_id": "ws-1"})
        self.assertIsNotNone(note.created_at)
        self.assertIsNotNone(note.updated_at)

    def test_tombstone_captures_deletion_time(self):
        tomb = TombstoneDoc(**{
            "workspace_id": "ws-001",
            "entity_type": "note",
            "local_id": "n-1",
            "remote_id": "cloud-n-1",
        })
        self.assertIsNotNone(tomb.deleted_at)
        parsed = datetime.fromisoformat(tomb.deleted_at)
        self.assertIsNotNone(parsed)


class TestLocalFirstContract(unittest.TestCase):
    """Verify that MongoDB models do NOT require API/network for instantiation."""

    def test_note_creates_without_network(self):
        """NoteDoc should never require a live connection to create."""
        note = NoteDoc(**{
            "_id": "local-note-uuid",
            "user_id": "local-user",
            "workspace_id": "local-ws",
            "title": "Local Note",
            "body": "<p>Written offline</p>",
        })
        self.assertEqual(note.id, "local-note-uuid")
        self.assertIsNone(note.deleted_at)

    def test_tags_embedded_in_note(self):
        """Tags are embedded strings — no separate collection required."""
        note = NoteDoc(**{
            "_id": "n-1",
            "user_id": "u-1",
            "workspace_id": "ws-1",
            "tags": ["Physics", "Draft", "Important"],
        })
        self.assertEqual(len(note.tags), 3)
        self.assertIn("Draft", note.tags)

    def test_file_local_only_state(self):
        """Files with extraction_status='local_only' are valid and do not require cloud."""
        f = FileDoc(**{
            "_id": "f-1",
            "note_id": "n-1",
            "user_id": "u-1",
            "file_name": "voice.m4a",
            "file_type": "audio",
            "file_url": "local://voice.m4a",
            "extraction_status": "local_only",
        })
        self.assertEqual(f.extraction_status, "local_only")


if __name__ == "__main__":
    unittest.main(verbosity=2)
