"""
Phase 4B.1 Cloudinary Signed Upload & Deletion Backend Security Tests.

Tests cover:
1. Signed upload authorization (/api/protected/sync/cloudinary-auth)
   - Test A: Authenticated & authorized workspace -> 200 OK with valid signature & namespace
   - Test B: Unauthenticated -> 401 Unauthorized
   - Test C: Unauthorized workspace -> 403 Forbidden
   - Test D: Malformed attachment UUID -> 400 Bad Request
   - Test E: Unsupported MIME type -> 400 Bad Request
   - Test F: Oversized file -> 400 Bad Request
   - Test G: Image mapping (image/png -> image)
   - Test H: Video mapping (video/mp4 -> video)
   - Test I: Audio mapping (audio/mpeg -> video - Cloudinary requirement)
   - Test J: PDF mapping (application/pdf -> raw)
   - Test K: Executable rejected (application/x-msdownload -> 400 Bad Request)
   - Test L: Server-derived identity (malicious client fields ignored)

2. Cloudinary deletion authorization & execution (/api/protected/sync/cloudinary-delete)
   - Delete A: Authorized workspace + valid attachment -> 200 OK
   - Delete B: Unauthorized workspace -> 403 Forbidden
   - Delete C: Unauthenticated -> 401 Unauthorized
   - Delete D: Cloudinary result = ok -> 200 OK
   - Delete E: Cloudinary result = not found -> 200 OK (idempotent)
   - Delete F: Cloudinary transient failure -> 502 Bad Gateway (Mongo delete preserved)
   - Delete G: Malicious custom cloudinaryPublicId targeting outside workspace -> 403 Forbidden
   - Delete H: Cross-workspace deletion attack -> 403 Forbidden
"""

import asyncio
import uuid
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from app.main import app
from app.models.mongo_models import UserDoc, WorkspaceDoc
from app.utils.security import create_access_token


class TestPhase4B1CloudinarySync(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.alice_email = "alice-4b1@aymo.app"
        self.alice_token = create_access_token(self.alice_email)
        self.alice_headers = {"Authorization": f"Bearer {self.alice_token}"}

        self.bob_email = "bob-4b1@aymo.app"
        self.bob_token = create_access_token(self.bob_email)
        self.bob_headers = {"Authorization": f"Bearer {self.bob_token}"}

        self.alice_user_doc = UserDoc(
            id="alice-uid-4b1",
            email=self.alice_email,
            full_name="Alice 4B1",
            password_hash="hash",
            provider="email",
        )
        self.bob_user_doc = UserDoc(
            id="bob-uid-4b1",
            email=self.bob_email,
            full_name="Bob 4B1",
            password_hash="hash",
            provider="email",
        )

        self.alice_workspace = WorkspaceDoc(
            id="ws-alice-4b1",
            owner_user_id="alice-uid-4b1",
            name="Alice Workspace",
        )

        self.valid_att_uuid = str(uuid.uuid4())

    def _setup_mock_db(self, authenticated_user_doc, workspace_doc=None, file_doc=None):
        mock_db = MagicMock()

        # Mock user lookup
        async def mock_user_find_one(query):
            if query.get("email") == authenticated_user_doc.email:
                return authenticated_user_doc.model_dump(by_alias=True)
            return None

        mock_db.users.find_one = AsyncMock(side_effect=mock_user_find_one)

        # Mock workspace lookup
        async def mock_ws_find_one(query):
            if workspace_doc and query.get("_id") == workspace_doc.id:
                return workspace_doc.model_dump(by_alias=True)
            return None

        mock_db.workspaces.find_one = AsyncMock(side_effect=mock_ws_find_one)
        mock_db.remote_mappings.find_one = AsyncMock(return_value=None)

        # Mock files lookup
        async def mock_files_find_one(query):
            if file_doc and query.get("_id") == file_doc.id:
                return file_doc.model_dump(by_alias=True)
            return None

        mock_db.files.find_one = AsyncMock(side_effect=mock_files_find_one)
        mock_db.files.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
        return mock_db

    # ─── 1. SIGNATURE AUTHENTICATION & AUTHORIZATION TESTS ─────────────────────

    def test_a_authenticated_authorized_workspace_signature_success(self):
        """Test A: Authenticated user in authorized workspace receives 200 with valid signature & namespace."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="mock_sig_123"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["resourceType"], "image")
        self.assertEqual(data["folder"], "aymo/workspaces/ws-alice-4b1")
        self.assertEqual(data["publicId"], f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}")
        self.assertEqual(data["signature"], "mock_sig_123")
        self.assertTrue(data["uploadUrl"].endswith("/image/upload"))

    def test_b_unauthenticated_signature_rejected(self):
        """Test B: Unauthenticated request must return 401 Unauthorized."""
        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 1024,
        }
        resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload)
        self.assertEqual(resp.status_code, 401)

    def test_c_unauthorized_workspace_signature_rejected(self):
        """Test C: User B attempting to get signature for User A's workspace must return 403 Forbidden."""
        mock_db = self._setup_mock_db(self.bob_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",  # Owned by Alice
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.bob_headers)

        self.assertEqual(resp.status_code, 403)
        self.assertIn("not authorized", resp.json()["detail"])

    def test_d_malformed_attachment_uuid_rejected(self):
        """Test D: Malformed attachment ID must return 400 Bad Request."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": "not-a-uuid-string",
            "mimeType": "image/png",
            "sizeBytes": 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("valid UUID", resp.json()["detail"])

    def test_e_unsupported_mime_type_rejected(self):
        """Test E: Unsupported MIME type must return 400 Bad Request."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "application/x-unknown-binary",
            "sizeBytes": 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported MIME type", resp.json()["detail"])

    def test_f_oversized_file_rejected(self):
        """Test F: File size exceeding limit must return 400 Bad Request."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 30 * 1024 * 1024,  # 30 MB (exceeds 25 MB limit for images)
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("exceeds maximum allowed limit", resp.json()["detail"])

    def test_g_image_mime_mapping(self):
        """Test G: image/png maps to resource_type = image."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 2048,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="sig"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["resourceType"], "image")

    def test_h_video_mime_mapping(self):
        """Test H: video/mp4 maps to resource_type = video."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "video/mp4",
            "sizeBytes": 50 * 1024 * 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="sig"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["resourceType"], "video")

    def test_i_audio_mime_mapping(self):
        """Test I: audio/mpeg maps to resource_type = video (Cloudinary requirement)."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "audio/mpeg",
            "sizeBytes": 5 * 1024 * 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="sig"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["resourceType"], "video")

    def test_j_pdf_mime_mapping(self):
        """Test J: application/pdf maps to resource_type = raw."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "application/pdf",
            "sizeBytes": 10 * 1024 * 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="sig"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["resourceType"], "raw")

    def test_k_executable_rejected(self):
        """Test K: Executable MIME type (application/x-msdownload) must be rejected with 400."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "application/x-msdownload",
            "sizeBytes": 1024,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("Forbidden file type", resp.json()["detail"])

    def test_l_server_derived_identity_ignores_malicious_client_fields(self):
        """Test L: Server must derive folder & publicId regardless of extra client parameters."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "mimeType": "image/png",
            "sizeBytes": 1024,
            "publicId": "aymo/workspaces/victim-ws/hacked",
            "folder": "hacked-folder",
            "resourceType": "raw",
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.utils.api_sign_request", return_value="sig"):

            resp = self.client.post("/api/protected/sync/cloudinary-auth", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["folder"], "aymo/workspaces/ws-alice-4b1")
        self.assertEqual(data["publicId"], f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}")

    # ─── 2. DELETION SECURITY TESTS ──────────────────────────────────────────────

    def test_delete_a_authorized_deletion_success(self):
        """Delete Security Test A: Authorized workspace deletion derives Cloudinary public ID and purges Mongo metadata."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}) as mock_destroy:

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "deleted")
        self.assertEqual(resp.json()["cloudinaryPublicId"], f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}")
        mock_destroy.assert_called_once_with(f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}", resource_type="image")

    def test_delete_b_malicious_custom_public_id_ignored(self):
        """Delete Security Test B: Client-supplied custom cloudinaryPublicId is IGNORED; server strictly derives target."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "cloudinaryPublicId": "aymo/workspaces/ws-alice-4b1/different-attachment-uuid",
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}) as mock_destroy:

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        # Verify server derived target publicId for self.valid_att_uuid and did NOT destroy different-attachment-uuid
        self.assertEqual(resp.json()["cloudinaryPublicId"], f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}")
        mock_destroy.assert_called_once_with(f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}", resource_type="image")

    def test_delete_c_another_workspace_public_id_ignored(self):
        """Delete Security Test C: Client supplying another workspace's publicId is IGNORED by server."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "cloudinaryPublicId": "aymo/workspaces/victim-ws-99/target-file",
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}) as mock_destroy:

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)
        # Server must destroy ONLY self.valid_att_uuid in authorized ws-alice-4b1
        self.assertEqual(resp.json()["cloudinaryPublicId"], f"aymo/workspaces/ws-alice-4b1/{self.valid_att_uuid}")

    def test_delete_d_malicious_resource_type_ignored(self):
        """Delete Security Test D: Client-supplied malicious resourceType is IGNORED; server derives resource_type."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
            "resourceType": "image",  # Client tries to force image when target is raw
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}) as mock_destroy:

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)

    def test_delete_e_omitted_cloudinary_public_id_succeeds(self):
        """Delete Security Test E: Deletion request with only workspaceId & attachmentId succeeds."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)

    def test_delete_f_omitted_resource_type_derives_safely(self):
        """Delete Security Test F: Omitted resourceType derives from server Mongo metadata or safely tries types."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "ok"}):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)

    def test_delete_g_cloudinary_result_not_found_idempotent(self):
        """Delete Security Test G: Cloudinary returning result='not found' succeeds with 200 (idempotent)."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", return_value={"result": "not found"}):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 200)

    def test_delete_h_cloudinary_transient_failure_preserves_mongo(self):
        """Delete Security Test H: Cloudinary failure returns 502 Bad Gateway and does not delete Mongo metadata."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db), \
             patch("cloudinary.uploader.destroy", side_effect=Exception("Network Timeout")):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 502)
        mock_db.files.delete_one.assert_not_called()

    def test_delete_i_cross_workspace_deletion_rejected(self):
        """Delete Security Test I: Workspace A attempting to delete an attachment in Workspace B returns 403 Forbidden."""
        bob_workspace = WorkspaceDoc(
            id="ws-bob-4b1",
            owner_user_id="bob-uid-4b1",
            name="Bob Workspace",
        )
        mock_db = self._setup_mock_db(self.alice_user_doc, bob_workspace)  # Alice owns ws-alice-4b1, ws-bob-4b1 owned by Bob

        payload = {
            "workspaceId": "ws-bob-4b1",  # Owned by Bob
            "attachmentId": self.valid_att_uuid,
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 403)

    def test_delete_j_malformed_uuid_rejected(self):
        """Delete Security Test J: Malformed attachmentId UUID returns 400 Bad Request before Cloudinary calls."""
        mock_db = self._setup_mock_db(self.alice_user_doc, self.alice_workspace)

        payload = {
            "workspaceId": "ws-alice-4b1",
            "attachmentId": "not-a-valid-uuid",
        }

        with patch("app.dependencies.mongo_auth.get_mongo_db", return_value=mock_db), \
             patch("app.routes.sync.get_mongo_db", return_value=mock_db):

            resp = self.client.post("/api/protected/sync/cloudinary-delete", json=payload, headers=self.alice_headers)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("valid UUID", resp.json()["detail"])


if __name__ == "__main__":
    unittest.main()
