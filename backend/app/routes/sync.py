"""
Authenticated cloud synchronization routes.
All routes require a valid JWT and enforce workspace/user ownership via repository classes.

ARCHITECTURE:
HTTP Route -> Auth Dependency -> Repository Layer -> MongoDB Atlas
Direct database access in routes is prohibited; all queries go through repository classes.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..dependencies.mongo_auth import AuthenticatedUser, get_current_mongo_user, require_workspace_access
from ..mongodb import get_mongo_db, is_mongo_available
from ..models.mongo_models import NoteDoc, FileDoc, AnnotationDoc
from ..repositories.mongo_repository import (
    WorkspaceMongoRepository,
    NoteMongoRepository,
    FileMongoRepository,
    AnnotationMongoRepository,
    SyncMongoRepository,
)
from ..storage.cloudinary_provider import (
    generate_signed_upload_params,
    delete_cloudinary_attachment,
    derive_attachment_cloudinary_identity,
)

logger = logging.getLogger("aymo.sync_route")
router = APIRouter(prefix="/api/protected/sync", tags=["sync"])


# ─── Pydantic Request / Response Models ────────────────────────────────────────

class WorkspaceRegisterRequest(BaseModel):
    workspaceId: str
    name: Optional[str] = "Default Workspace"


class WorkspaceRegisterResponse(BaseModel):
    status: str
    workspaceId: str
    ownerUserId: str


class SyncPushRequest(BaseModel):
    id: str
    workspaceId: str
    entityType: str
    operation: str
    localId: str
    payload: Dict[str, Any]
    createdAt: str
    updatedAt: str


class SyncPushResponse(BaseModel):
    remoteId: str


class SyncPullResponseItem(BaseModel):
    entityType: str
    operation: str
    localId: Optional[str] = None
    remoteId: str
    payload: Dict[str, Any]
    updatedAt: str


class SyncPullResponse(BaseModel):
    changes: List[SyncPullResponseItem]


class ConflictResolutionRequest(BaseModel):
    id: str
    workspaceId: str
    entityType: str
    localId: str
    localVersion: Dict[str, Any]
    remoteVersion: Dict[str, Any]


class ConflictResolutionResponse(BaseModel):
    resolution: str


class SyncStatusResponse(BaseModel):
    available: bool
    status: str


class CloudinaryAuthRequest(BaseModel):
    workspaceId: str
    attachmentId: str
    mimeType: str
    sizeBytes: int


class CloudinaryAuthResponse(BaseModel):
    cloudName: str
    apiKey: str
    timestamp: int
    publicId: str
    folder: str
    resourceType: str
    signature: str
    uploadUrl: str


class CloudinaryDeleteRequest(BaseModel):
    workspaceId: str
    attachmentId: str

    class Config:
        extra = "ignore"


class CloudinaryDeleteResponse(BaseModel):
    status: str
    attachmentId: str
    cloudinaryPublicId: str


# ─── Internal Helper: Get DB & Repositories ───────────────────────────────────

def _get_repos():
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is currently offline. Local notes continue working. Please try sync again later.",
        )
    return {
        "db": db,
        "workspace": WorkspaceMongoRepository(db),
        "note": NoteMongoRepository(db),
        "file": FileMongoRepository(db),
        "annotation": AnnotationMongoRepository(db),
        "sync": SyncMongoRepository(db),
    }


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/workspace/register", response_model=WorkspaceRegisterResponse)
async def register_workspace(
    body: WorkspaceRegisterRequest,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Explicitly registers a workspace to the authenticated user.
    Idempotent: succeeds if already owned by current_user.
    Raises 403 Forbidden if workspace is already owned by another user.
    """
    repos = _get_repos()
    ws_repo: WorkspaceMongoRepository = repos["workspace"]

    try:
        ws = await ws_repo.register_workspace(
            workspace_id=body.workspaceId,
            owner_user_id=current_user.user_id,
            name=body.name or "Default Workspace"
        )
        return WorkspaceRegisterResponse(
            status="registered",
            workspaceId=ws.id,
            ownerUserId=ws.owner_user_id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc)
        )


@router.post("/push", response_model=SyncPushResponse)
async def sync_push(
    body: SyncPushRequest,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Pushes a single operation from the IndexedDB sync queue into MongoDB Atlas via Repositories.
    """
    repos = _get_repos()
    user_id = current_user.user_id
    workspace_id = body.workspaceId
    entity_type = body.entityType
    operation = body.operation
    local_id = body.localId
    payload = body.payload

    # Enforce workspace access
    await require_workspace_access(workspace_id, current_user)

    sync_repo: SyncMongoRepository = repos["sync"]
    note_repo: NoteMongoRepository = repos["note"]
    file_repo: FileMongoRepository = repos["file"]
    annotation_repo: AnnotationMongoRepository = repos["annotation"]

    try:
        remote_id = await sync_repo.get_or_create_remote_id(
            workspace_id=workspace_id,
            entity_type=entity_type,
            local_id=local_id,
            user_id=user_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    if entity_type == "note":
        if operation in ("create", "update", "restore", "rename", "duplicate"):
            note_doc = NoteDoc(
                id=local_id,
                user_id=user_id,
                workspace_id=workspace_id,
                title=payload.get("title", ""),
                body=payload.get("body", ""),
                is_pinned=payload.get("isPinned", False),
                is_favorited=payload.get("isFavorited", False),
                tags=payload.get("tags", []),
                files=payload.get("files", []),
                version=int(payload.get("version", 1)),
                deleted_at=payload.get("deletedAt"),
                created_at=payload.get("createdAt", body.createdAt),
                updated_at=datetime.now(timezone.utc).isoformat()
            )
            try:
                await note_repo.upsert_note(note_doc, user_id=user_id)
                logger.info(f"[SYNC-REPO] Upserted note {local_id} for user {user_id}")
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

        elif operation == "delete":
            is_permanent = payload.get("permanent", False)
            existing = await note_repo.get_by_id(local_id, user_id=user_id)
            if not existing:
                # Note might not exist or belongs to another user
                # Check if it belongs to another user
                db = repos["db"]
                other = await db.notes.find_one({"_id": local_id})
                if other and other.get("user_id") != user_id:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to delete this note.")

            if is_permanent:
                await note_repo.hard_delete(local_id, user_id=user_id)
                await sync_repo.create_tombstone(
                    workspace_id=workspace_id,
                    entity_type=entity_type,
                    local_id=local_id,
                    remote_id=remote_id,
                    user_id=user_id
                )
                logger.info(f"[SYNC-REPO] Hard-deleted note {local_id}")
            else:
                await note_repo.soft_delete(local_id, user_id=user_id)
                logger.info(f"[SYNC-REPO] Soft-deleted note {local_id}")

    elif entity_type in ("file", "attachment"):
        if operation in ("create", "update", "rename"):
            file_doc = FileDoc(
                id=local_id,
                note_id=payload.get("noteId", payload.get("note_id", "")),
                user_id=user_id,
                file_name=payload.get("name", payload.get("file_name", payload.get("fileName", "attachment"))),
                file_type=payload.get("kind", payload.get("file_type", payload.get("fileType", "image"))),
                file_url=payload.get("remoteUrl", payload.get("file_url", payload.get("fileUrl", ""))),
                file_size=payload.get("sizeBytes", payload.get("file_size", payload.get("fileSize", 0))),
                storage_key=payload.get("storageKey", payload.get("storage_key")),
                extraction_status=payload.get("extractionStatus", "completed"),
            )
            await file_repo.create_or_replace(file_doc, user_id=user_id)
        elif operation == "delete":
            await file_repo.delete(local_id, user_id=user_id)

    elif entity_type == "annotation":
        if operation in ("create", "update"):
            ann_doc = AnnotationDoc(
                id=local_id,
                user_id=user_id,
                source_type=payload.get("sourceType", "note"),
                source_id=payload.get("sourceId", ""),
                page_number=payload.get("pageNumber"),
                selected_text=payload.get("selectedText", ""),
                color=payload.get("color", "#FFE082"),
                annotation_type=payload.get("annotationType", "highlight"),
                comment=payload.get("comment"),
                linked_note_id=payload.get("linkedNoteId"),
            )
            await annotation_repo.create(ann_doc, user_id=user_id)
        elif operation == "delete":
            await annotation_repo.delete(local_id, user_id=user_id)

    return SyncPushResponse(remoteId=remote_id)


@router.get("/pull", response_model=SyncPullResponse)
async def sync_pull(
    workspaceId: str,
    since: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Pulls cloud changes for the authenticated user's workspace via Repositories.
    """
    repos = _get_repos()
    user_id = current_user.user_id

    await require_workspace_access(workspaceId, current_user)

    note_repo: NoteMongoRepository = repos["note"]
    sync_repo: SyncMongoRepository = repos["sync"]

    changes: List[SyncPullResponseItem] = []

    # Pull notes via NoteMongoRepository
    notes = await note_repo.list_notes(
        user_id=user_id,
        workspace_id=workspaceId,
        include_deleted=True
    )

    for note in notes:
        # Filter by since if specified
        if since and note.updated_at <= since:
            continue

        remote_id = await sync_repo.get_or_create_remote_id(
            workspace_id=workspaceId,
            entity_type="note",
            local_id=note.id,
            user_id=user_id
        )
        payload = note.model_dump(by_alias=True)
        payload.pop("_id", None)

        changes.append(SyncPullResponseItem(
            entityType="note",
            operation="delete" if note.deleted_at else "update",
            localId=note.id,
            remoteId=remote_id,
            payload=payload,
            updatedAt=note.updated_at
        ))

    # Pull tombstones via SyncMongoRepository
    tombstones = await sync_repo.get_tombstones_since(
        workspace_id=workspaceId,
        user_id=user_id,
        since=since
    )

    for tomb in tombstones:
        changes.append(SyncPullResponseItem(
            entityType=tomb.entity_type,
            operation="delete",
            localId=tomb.local_id,
            remoteId=tomb.remote_id,
            payload={"permanent": True},
            updatedAt=tomb.deleted_at
        ))

    changes.sort(key=lambda x: x.updatedAt)
    return SyncPullResponse(changes=changes)


@router.post("/conflict", response_model=ConflictResolutionResponse)
async def resolve_conflict(
    body: ConflictResolutionRequest,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Conflict resolution endpoint. Uses NoteMongoRepository to verify note ownership.
    """
    repos = _get_repos()
    user_id = current_user.user_id

    await require_workspace_access(body.workspaceId, current_user)

    if body.entityType == "note":
        note_repo: NoteMongoRepository = repos["note"]
        note = await note_repo.get_by_id(body.localId, user_id=user_id)
        if not note:
            # Check if note exists under another user
            db = repos["db"]
            other = await db.notes.find_one({"_id": body.localId})
            if other and other.get("user_id") != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to resolve conflicts for this entity."
                )

    return ConflictResolutionResponse(resolution="local-wins")


@router.get("/status", response_model=SyncStatusResponse)
async def sync_status():
    """
    Public sync health check. Does not require authentication.
    """
    available = is_mongo_available()
    return SyncStatusResponse(
        available=available,
        status="active" if available else "offline"
    )


@router.post("/cloudinary-auth", response_model=CloudinaryAuthResponse)
async def cloudinary_auth(
    body: CloudinaryAuthRequest,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Generates scoped Cloudinary authorization parameters for direct browser upload.
    Enforces JWT auth, workspace access, UUID validation, MIME allowlist, and file size limits.
    """
    # 1. Validate attachmentId UUID format
    try:
        val_uuid = uuid.UUID(body.attachmentId)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="attachmentId must be a valid UUID string."
        )

    # 2. Authorize workspace access
    await require_workspace_access(body.workspaceId, current_user)

    # 3. Generate signature & server-derived parameters via storage provider helper
    try:
        auth_data = generate_signed_upload_params(
            workspace_id=body.workspaceId,
            attachment_id=str(val_uuid),
            mime_type=body.mimeType,
            size_bytes=body.sizeBytes,
        )
        return CloudinaryAuthResponse(**auth_data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )
    except Exception as exc:
        logger.error(f"[CLOUDINARY-AUTH] Signature error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not generate upload signature."
        )


@router.post("/cloudinary-delete", response_model=CloudinaryDeleteResponse)
async def cloudinary_delete(
    body: CloudinaryDeleteRequest,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    """
    Deletes an attachment asset from Cloudinary and purges metadata from MongoDB Atlas.
    Requires JWT auth and workspace authorization.
    Server derives the Cloudinary public_id strictly from workspaceId + attachmentId.
    Client input cannot select or override the Cloudinary public_id or resource_type.
    Idempotent: treating Cloudinary 'ok' and 'not found' as success.
    """
    # 1. Validate attachmentId UUID format
    try:
        val_uuid = uuid.UUID(body.attachmentId)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="attachmentId must be a valid UUID string."
        )

    # 2. Authorize workspace access
    await require_workspace_access(body.workspaceId, current_user)

    # 3. Server-derived Cloudinary public_id (STRICT: client input cannot select target public_id)
    folder, target_public_id = derive_attachment_cloudinary_identity(
        workspace_id=body.workspaceId,
        attachment_id=str(val_uuid)
    )

    # 4. Check MongoDB metadata for authoritative resource_type if document exists
    repos = _get_repos()
    file_repo: FileMongoRepository = repos["file"]

    server_resource_type = None
    existing_file = await file_repo.get_by_id(body.attachmentId, user_id=current_user.user_id)
    if existing_file and existing_file.file_type:
        ft = str(existing_file.file_type).lower()
        if ft == "image":
            server_resource_type = "image"
        elif ft in ("video", "audio"):
            server_resource_type = "video"
        elif ft in ("pdf", "document", "link"):
            server_resource_type = "raw"

    # 5. Destroy asset on Cloudinary using server-derived target_public_id and server_resource_type
    try:
        delete_cloudinary_attachment(
            public_id=target_public_id,
            resource_type=server_resource_type
        )
    except RuntimeError as exc:
        logger.error(f"[CLOUDINARY-DELETE] Cloudinary error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Cloudinary deletion failed."
        )

    # 6. Delete metadata from MongoDB
    await file_repo.delete(body.attachmentId, user_id=current_user.user_id)

    return CloudinaryDeleteResponse(
        status="deleted",
        attachmentId=body.attachmentId,
        cloudinaryPublicId=target_public_id
    )

