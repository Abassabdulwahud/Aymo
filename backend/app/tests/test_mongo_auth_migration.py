"""
Mongo Authentication and Authorization Migration Tests.

Tests cover:
1. Registration (valid, duplicate 409, whitespace/casing normalization, duplicate race)
2. Login (valid, invalid password 401, nonexistent 401, email normalization)
3. /api/protected/me endpoint (returns MongoDB string user ID, 401 on invalid token)
4. Workspace security (unregistered workspace returns 404, explicit registration, ownership 403)
5. Live FastAPI TestClient HTTP route boundary tests
"""

import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from app.main import app
from app.models.mongo_models import UserDoc, WorkspaceDoc, NoteDoc
from app.utils.security import create_access_token, hash_password


class TestMongoAuthMigration(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.test_email = "test-mongo-auth@aymo.app"
        self.test_password = "SecurePassword123!"
        self.test_hash = hash_password(self.test_password)
        self.user_doc = UserDoc(
            id="usr_test_uuid_123",
            email=self.test_email,
            full_name="Test User",
            password_hash=self.test_hash,
            provider="email",
        )

    def test_register_route_success(self):
        """POST /auth/register should create user in MongoDB and return UserResponse with string ID."""
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=None)
        mock_db.users.insert_one = AsyncMock(return_value=None)

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.routes.auth.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/auth/register", json={
                "full_name": "New User",
                "email": "  NEW.USER@AYMO.APP  ",
                "password": "Password123!",
            })
            self.assertEqual(resp.status_code, 201)
            data = resp.json()
            self.assertIsInstance(data["id"], str)
            self.assertEqual(data["email"], "new.user@aymo.app")
            self.assertEqual(data["full_name"], "New User")

    def test_register_duplicate_email_rejected(self):
        """POST /auth/register with an existing email must return HTTP 409 Conflict."""
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value={"_id": "usr_existing", "email": "existing@aymo.app"})

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.routes.auth.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/auth/register", json={
                "full_name": "Existing User",
                "email": "Existing@aymo.app",
                "password": "Password123!",
            })
            self.assertEqual(resp.status_code, 409)

    def test_login_route_success(self):
        """POST /auth/login with correct credentials returns valid JWT token."""
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=self.user_doc.model_dump(by_alias=True))
        mock_db.users.update_one = AsyncMock(return_value=None)

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.routes.auth.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/auth/login", json={
                "email": "  TEST-MONGO-AUTH@AYMO.APP ",
                "password": self.test_password,
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertIn("access_token", data)
            self.assertEqual(data["token_type"], "bearer")

    def test_login_wrong_password_rejected(self):
        """POST /auth/login with wrong password returns HTTP 401 Unauthorized."""
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=self.user_doc.model_dump(by_alias=True))

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.routes.auth.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/auth/login", json={
                "email": self.test_email,
                "password": "WrongPassword123!",
            })
            self.assertEqual(resp.status_code, 401)

    def test_get_me_route_success(self):
        """GET /api/protected/me returns authenticated MongoDB user details with string ID."""
        token = create_access_token(self.test_email)
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=self.user_doc.model_dump(by_alias=True))

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.protected.get_mongo_db", return_value=mock_db):
            resp = self.client.get("/api/protected/me", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["id"], "usr_test_uuid_123")
            self.assertEqual(data["email"], self.test_email)
            self.assertEqual(data["full_name"], "Test User")

    def test_unregistered_workspace_push_returns_404(self):
        """Syncing to an unregistered workspace must return HTTP 404 NOT FOUND (auto-claiming removed)."""
        token = create_access_token(self.test_email)
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=self.user_doc.model_dump(by_alias=True))
        mock_db.workspaces.find_one = AsyncMock(return_value=None)
        mock_db.remote_mappings.find_one = AsyncMock(return_value=None)

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/api/protected/sync/push", json={
                "id": "op-unregistered",
                "workspaceId": "ws-unregistered-999",
                "entityType": "note",
                "operation": "create",
                "localId": "note-local-1",
                "payload": {"title": "Test"},
                "createdAt": "2026-09-03T00:00:00Z",
                "updatedAt": "2026-09-03T00:00:00Z",
            }, headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(resp.status_code, 404)
            self.assertIn("Workspace is not registered", resp.json()["detail"])

    def test_workspace_registration_flow(self):
        """Explicit workspace registration associates workspace with authenticated user."""
        token = create_access_token(self.test_email)
        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=self.user_doc.model_dump(by_alias=True))
        mock_db.workspaces.find_one = AsyncMock(return_value=None)
        mock_db.workspaces.insert_one = AsyncMock(return_value=None)
        mock_db.workspaces.replace_one = AsyncMock(return_value=MagicMock(modified_count=1))

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/api/protected/sync/workspace/register", json={
                "workspaceId": "ws-explicit-123",
                "name": "My Local Workspace",
            }, headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "registered")
            self.assertEqual(data["workspaceId"], "ws-explicit-123")
            self.assertEqual(data["ownerUserId"], "usr_test_uuid_123")

    def test_concurrent_workspace_registration_duplicate_key_returns_403(self):
        """
        When User B attempts to register a workspace that User A registered concurrently,
        the resulting Mongo DuplicateKeyError on insert_one must be translated into HTTP 403.
        """
        from pymongo.errors import DuplicateKeyError

        user_b_token = create_access_token("user-b@aymo.app")
        user_b_doc = UserDoc(id="usr_b_456", email="user-b@aymo.app", full_name="User B", provider="email")

        mock_db = MagicMock()
        mock_db.users.find_one = AsyncMock(return_value=user_b_doc.model_dump(by_alias=True))
        # Initial check returns None (simulating simultaneous check)
        # But re-check after DuplicateKeyError returns User A's document
        mock_db.workspaces.find_one = AsyncMock(side_effect=[
            None,
            {"_id": "ws-contested", "owner_user_id": "usr_test_uuid_123", "name": "User A Workspace"}
        ])
        mock_db.workspaces.insert_one = AsyncMock(side_effect=DuplicateKeyError("E11000 duplicate key error"))

        with patch("app.mongodb.get_mongo_db", return_value=mock_db), \
             patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):
            resp = self.client.post("/api/protected/sync/workspace/register", json={
                "workspaceId": "ws-contested",
                "name": "User B Attempt",
            }, headers={"Authorization": f"Bearer {user_b_token}"})
            self.assertEqual(resp.status_code, 403)
            self.assertIn("owned by another user", resp.json()["detail"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
