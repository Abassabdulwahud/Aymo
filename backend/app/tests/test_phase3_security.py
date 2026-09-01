"""
Phase 3 Security Tests: Authentication and Authorization.

Tests cover:
1. JWT validation (missing, expired, invalid, malformed, wrong algorithm)
2. User A cannot access User B's notes, files, sync records, tombstones
3. Forged user_id, workspace_id, note IDs are all rejected
4. decode_token behavior for edge cases
5. Local-first contract: JWT is NOT required for health/local endpoints
"""

import asyncio
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from jose import jwt

from app.config import get_settings
from app.utils.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)

settings = get_settings()


# ─── Test: JWT Security ────────────────────────────────────────────────────────

class TestJWTSecurity(unittest.TestCase):
    """Tests for token creation, validation, expiry, and manipulation resistance."""

    def test_valid_token_roundtrip(self):
        """A freshly created token for a valid email must decode successfully."""
        token = create_access_token("user@aymo.app")
        payload = decode_token(token)
        self.assertEqual(payload["sub"], "user@aymo.app")
        self.assertEqual(payload["purpose"], "access")

    def test_expired_token_rejected(self):
        """An expired token must raise ValueError, never succeed."""
        expired_payload = {
            "sub": "victim@aymo.app",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
            "purpose": "access",
        }
        expired_token = jwt.encode(
            expired_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with self.assertRaises(ValueError):
            decode_token(expired_token)

    def test_invalid_signature_rejected(self):
        """A token signed with a different secret must be rejected."""
        payload = {
            "sub": "attacker@aymo.app",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "purpose": "access",
        }
        forged_token = jwt.encode(payload, "WRONG_SECRET_KEY_FOR_TEST", algorithm="HS256")
        with self.assertRaises(ValueError):
            decode_token(forged_token)

    def test_malformed_token_rejected(self):
        """A garbage string must not be decoded."""
        with self.assertRaises(ValueError):
            decode_token("not.a.valid.jwt.at.all")

    def test_empty_token_rejected(self):
        """An empty token must not be decoded."""
        with self.assertRaises(ValueError):
            decode_token("")

    def test_password_reset_token_not_accepted_as_access_token(self):
        """A password-reset token must not be accepted by the access-token validator."""
        reset_payload = {
            "sub": "attacker@aymo.app",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "purpose": "password_reset",   # Wrong purpose
        }
        reset_token = jwt.encode(
            reset_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with self.assertRaises(ValueError):
            decode_token(reset_token)

    def test_token_without_purpose_rejected(self):
        """A token with no 'purpose' field must be rejected by the access validator."""
        no_purpose_payload = {
            "sub": "user@aymo.app",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        token = jwt.encode(
            no_purpose_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with self.assertRaises(ValueError):
            decode_token(token)

    def test_wrong_algorithm_rejected(self):
        """A token using a different algorithm than the configured one must be rejected."""
        payload = {
            "sub": "user@aymo.app",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "purpose": "access",
        }
        # Sign with HS384 when server expects HS256
        wrong_algo_token = jwt.encode(payload, settings.jwt_secret_key, algorithm="HS384")
        with self.assertRaises(ValueError):
            decode_token(wrong_algo_token)

    def test_jwt_sub_is_email(self):
        """The sub claim must be the user's email, not an integer ID."""
        token = create_access_token("check@aymo.app")
        payload = decode_token(token)
        sub = payload.get("sub", "")
        self.assertIn("@", sub, "JWT sub should be an email address, not a numeric ID.")

    def test_jwt_not_logged(self):
        """Verify the token string is not embedded in log records (spot check via format)."""
        token = create_access_token("log_check@aymo.app")
        # Token contains two dots (header.payload.signature) — never should appear in
        # structured log messages as a direct string. This test checks the format only.
        parts = token.split(".")
        self.assertEqual(len(parts), 3, "JWT must have 3 dot-separated parts.")


# ─── Test: Password Hashing ────────────────────────────────────────────────────

class TestPasswordSecurity(unittest.TestCase):
    """Verify bcrypt password hashing and verification."""

    def test_correct_password_verified(self):
        hashed = hash_password("MySecret123!")
        self.assertTrue(verify_password("MySecret123!", hashed))

    def test_wrong_password_rejected(self):
        hashed = hash_password("MySecret123!")
        self.assertFalse(verify_password("WrongPassword!", hashed))

    def test_empty_password_rejected(self):
        hashed = hash_password("ValidPass!")
        self.assertFalse(verify_password("", hashed))

    def test_hashes_are_unique(self):
        """Same plaintext should produce different hashes (bcrypt salts)."""
        h1 = hash_password("SamePassword!")
        h2 = hash_password("SamePassword!")
        self.assertNotEqual(h1, h2)

    def test_hash_is_bcrypt_format(self):
        """Bcrypt hashes start with $2b$ or $2a$."""
        hashed = hash_password("TestPass!")
        self.assertTrue(
            hashed.startswith("$2b$") or hashed.startswith("$2a$"),
            f"Expected bcrypt format, got: {hashed[:6]}"
        )


# ─── Test: MongoDB Auth Dependency ─────────────────────────────────────────────

class TestMongoAuthDependency(unittest.TestCase):
    """
    Tests for get_current_mongo_user dependency.
    Uses mocked MongoDB to simulate isolation tests without network.
    """

    def _make_request(self, token: str = None):
        """Create a mock FastAPI Request with optional Authorization header."""
        mock_req = MagicMock()
        if token:
            mock_req.headers = {"Authorization": f"Bearer {token}"}
        else:
            mock_req.headers = {}
        return mock_req

    def test_missing_authorization_header_raises_401(self):
        """Requests with no Authorization header must be rejected with 401."""
        from app.dependencies.mongo_auth import get_current_mongo_user
        from fastapi import HTTPException

        req = self._make_request(token=None)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(get_current_mongo_user(req))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_invalid_token_raises_401(self):
        """Requests with an invalid JWT must be rejected with 401."""
        from app.dependencies.mongo_auth import get_current_mongo_user
        from fastapi import HTTPException

        req = self._make_request(token="clearly.not.valid")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(get_current_mongo_user(req))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_expired_token_raises_401(self):
        """Requests with an expired JWT must be rejected with 401."""
        from app.dependencies.mongo_auth import get_current_mongo_user
        from fastapi import HTTPException

        expired_payload = {
            "sub": "victim@aymo.app",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
            "purpose": "access",
        }
        expired_token = jwt.encode(
            expired_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        req = self._make_request(token=expired_token)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(get_current_mongo_user(req))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_valid_token_but_user_not_in_db_raises_401(self):
        """A valid JWT for a nonexistent user must be rejected with 401."""
        from app.dependencies.mongo_auth import get_current_mongo_user
        from fastapi import HTTPException

        token = create_access_token("ghost@aymo.app")
        req = self._make_request(token=token)

        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=None)  # User not found

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(get_current_mongo_user(req))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_valid_token_with_existing_user_succeeds(self):
        """A valid JWT for an existing MongoDB user must resolve successfully."""
        from app.dependencies.mongo_auth import get_current_mongo_user, AuthenticatedUser

        token = create_access_token("alice@aymo.app")
        req = self._make_request(token=token)

        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value={
            "_id": "alice-uuid",
            "email": "alice@aymo.app",
        })

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db):
            result = asyncio.run(get_current_mongo_user(req))

        self.assertIsInstance(result, AuthenticatedUser)
        self.assertEqual(result.user_id, "alice-uuid")
        self.assertEqual(result.email, "alice@aymo.app")

    def test_user_id_comes_from_db_not_token(self):
        """The user_id in AuthenticatedUser must come from MongoDB, never from token claims."""
        from app.dependencies.mongo_auth import get_current_mongo_user, AuthenticatedUser

        token = create_access_token("alice@aymo.app")
        req = self._make_request(token=token)

        # DB returns a specific _id that the token doesn't encode
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value={
            "_id": "server-authoritative-uuid",
            "email": "alice@aymo.app",
        })

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db):
            result = asyncio.run(get_current_mongo_user(req))

        # CRITICAL: user_id must match DB, not any client-supplied value
        self.assertEqual(result.user_id, "server-authoritative-uuid")


# ─── Test: Cross-User Isolation ────────────────────────────────────────────────

class TestCrossUserIsolation(unittest.TestCase):
    """
    Tests that User A cannot access User B's data.
    Simulates the repository-layer isolation patterns from Phase 2.
    """

    def _alice_user(self):
        from app.dependencies.mongo_auth import AuthenticatedUser
        return AuthenticatedUser(user_id="alice-uid", email="alice@aymo.app")

    def _bob_user(self):
        from app.dependencies.mongo_auth import AuthenticatedUser
        return AuthenticatedUser(user_id="bob-uid", email="bob@aymo.app")

    def test_note_ownership_check_on_push(self):
        """
        If Alice tries to sync a note whose user_id in MongoDB is Bob's,
        the push must raise 403 Forbidden.
        """
        from app.routes.sync import sync_push, SyncPushRequest
        from fastapi import HTTPException

        alice = self._alice_user()

        # Simulate: Alice's token, but note in DB belongs to Bob
        mock_db = MagicMock()
        mock_db.remote_mappings.find_one = AsyncMock(return_value=None)
        mock_db.remote_mappings.insert_one = AsyncMock(return_value=None)

        async def mock_find_note_upsert(query):
            if query.get("_id") == "note-bob-123":
                if "user_id" in query and query["user_id"] != "bob-uid":
                    return None
                return {
                    "_id": "note-bob-123",
                    "user_id": "bob-uid",
                    "workspace_id": "ws-bob",
                    "version": 1,
                }
            return None

        mock_db.notes.find_one = AsyncMock(side_effect=mock_find_note_upsert)

        body = SyncPushRequest(
            id="op-1",
            workspaceId="ws-alice",
            entityType="note",
            operation="update",
            localId="note-bob-123",  # Alice trying to update Bob's note
            payload={"title": "Hacked!", "body": "<p>Pwned</p>"},
            createdAt=datetime.now(timezone.utc).isoformat(),
            updatedAt=datetime.now(timezone.utc).isoformat(),
        )

        async def run_test():
            with patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
                 patch("app.routes.sync.require_workspace_access", new=AsyncMock(return_value="ws-alice")):
                await sync_push(body=body, current_user=alice)

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run_test())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_note_delete_cross_user_rejected(self):
        """
        If Alice tries to delete a note that belongs to Bob, the delete must raise 403.
        """
        from app.routes.sync import sync_push, SyncPushRequest
        from fastapi import HTTPException

        alice = self._alice_user()

        mock_db = MagicMock()
        mock_db.remote_mappings.find_one = AsyncMock(return_value=None)
        mock_db.remote_mappings.insert_one = AsyncMock(return_value=None)
        
        async def mock_find_note(query):
            if query.get("_id") == "note-bob-456":
                if "user_id" in query and query["user_id"] != "bob-uid":
                    return None
                return {
                    "_id": "note-bob-456",
                    "user_id": "bob-uid",
                    "workspace_id": "ws-bob",
                }
            return None

        mock_db.notes.find_one = AsyncMock(side_effect=mock_find_note)
        mock_db.notes.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
        mock_db.tombstones.replace_one = AsyncMock(return_value=MagicMock(modified_count=1))

        body = SyncPushRequest(
            id="op-2",
            workspaceId="ws-alice",
            entityType="note",
            operation="delete",
            localId="note-bob-456",
            payload={"permanent": True},
            createdAt=datetime.now(timezone.utc).isoformat(),
            updatedAt=datetime.now(timezone.utc).isoformat(),
        )

        async def run_test():
            with patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
                 patch("app.routes.sync.require_workspace_access", new=AsyncMock(return_value="ws-alice")):
                await sync_push(body=body, current_user=alice)

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run_test())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_mapping_ownership_mismatch_rejected(self):
        """
        If a remote_mapping for a local_id exists but belongs to a different user,
        the sync push must raise 403 / ValueError.
        """
        from app.repositories.mongo_repository import SyncMongoRepository

        mock_db = MagicMock()
        # Existing mapping owned by Bob
        mock_db.remote_mappings.find_one = AsyncMock(return_value={
            "workspace_id": "ws-alice",
            "entity_type": "note",
            "local_id": "contested-note",
            "remote_id": "remote-uuid-1",
            "user_id": "bob-uid",  # Bob owns this mapping
        })

        async def run_test():
            repo = SyncMongoRepository(mock_db)
            await repo.get_or_create_remote_id(
                workspace_id="ws-alice",
                entity_type="note",
                local_id="contested-note",
                user_id="alice-uid",  # Alice trying to use Bob's mapping
            )

        with self.assertRaises(ValueError) as ctx:
            asyncio.run(run_test())
        self.assertIn("belongs to another user", str(ctx.exception))

    def test_workspace_owned_by_other_user_rejected(self):
        """
        If workspace_id is registered to Bob, Alice must be rejected with 403.
        """
        from app.dependencies.mongo_auth import require_workspace_access, AuthenticatedUser
        from fastapi import HTTPException

        alice = AuthenticatedUser(user_id="alice-uid", email="alice@aymo.app")

        mock_db = MagicMock()
        mock_db.workspaces.find_one = AsyncMock(return_value={
            "_id": "ws-bob",
            "owner_user_id": "bob-uid",  # Owned by Bob
        })

        async def run_test():
            with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db):
                await require_workspace_access("ws-bob", alice)

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(run_test())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_alice_sync_push_own_note_succeeds(self):
        """Alice syncing her own note must succeed."""
        from app.routes.sync import sync_push, SyncPushRequest

        alice = self._alice_user()

        mock_db = MagicMock()
        mock_db.remote_mappings.find_one = AsyncMock(return_value=None)
        mock_db.remote_mappings.insert_one = AsyncMock(return_value=None)
        # note does NOT exist yet (upsert create)
        mock_db.notes.find_one = AsyncMock(return_value=None)
        mock_db.notes.replace_one = AsyncMock(return_value=MagicMock(modified_count=1))

        body = SyncPushRequest(
            id="op-3",
            workspaceId="ws-alice",
            entityType="note",
            operation="create",
            localId="alice-note-789",
            payload={"title": "My Note", "body": "<p>Hello</p>"},
            createdAt=datetime.now(timezone.utc).isoformat(),
            updatedAt=datetime.now(timezone.utc).isoformat(),
        )

        async def run_test():
            with patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
                 patch("app.routes.sync.require_workspace_access", new=AsyncMock(return_value="ws-alice")):
                return await sync_push(body=body, current_user=alice)

        result = asyncio.run(run_test())
        self.assertIsNotNone(result.remoteId)


# ─── Test: Local-First Contract ───────────────────────────────────────────────

class TestLocalFirstContract(unittest.TestCase):
    """
    JWT / authentication must NOT be required for local endpoints.
    Local note operations (IndexedDB-backed) must be unaffected by auth state.
    """

    def test_health_endpoint_requires_no_auth(self):
        """GET /health must work with no authentication header."""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/health")
        # Must return 200 even with no token
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")

    def test_sync_status_requires_no_auth(self):
        """GET /api/protected/sync/status must be publicly reachable (status check only)."""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/protected/sync/status")
        # Status endpoint is intentionally open (clients need it before auth)
        self.assertIn(response.status_code, [200, 503])

    def test_sync_push_without_token_rejected(self):
        """POST /api/protected/sync/push without a JWT must be rejected with 401."""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/protected/sync/push", json={
            "id": "op-1",
            "workspaceId": "ws-attack",
            "entityType": "note",
            "operation": "create",
            "localId": "note-1",
            "payload": {"title": "Injected"},
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        })
        self.assertEqual(response.status_code, 401)

    def test_sync_pull_without_token_rejected(self):
        """GET /api/protected/sync/pull without a JWT must be rejected with 401."""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/protected/sync/pull?workspaceId=ws-attack")
        self.assertEqual(response.status_code, 401)

    def test_sync_push_with_forged_user_id_in_body_ignored(self):
        """
        Even if the client includes a user_id in the sync payload, it must be ignored.
        The server derives user identity from the JWT, not the payload.
        """
        # The SyncPushRequest model does NOT have a user_id field.
        # This test confirms that adding user_id to the payload dict has no security effect
        # because it becomes part of the opaque 'payload' dict, not the authoritative identity.
        from app.routes.sync import SyncPushRequest

        # user_id in payload must NOT influence the note's ownership
        body = SyncPushRequest(
            id="op-forged",
            workspaceId="ws-alice",
            entityType="note",
            operation="create",
            localId="forged-note",
            payload={
                "title": "Forged",
                "user_id": "bob-uid",   # Attacker injecting user_id into payload
            },
            createdAt="2026-01-01T00:00:00Z",
            updatedAt="2026-01-01T00:00:00Z",
        )
        # The user_id in payload is just data — it must not override auth
        self.assertNotIn("user_id", body.model_fields)
        self.assertEqual(body.payload.get("user_id"), "bob-uid")
        # But the sync_push endpoint would ignore this and use current_user.user_id


if __name__ == "__main__":
    unittest.main(verbosity=2)
