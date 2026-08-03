import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field

from ..mongodb import get_mongo_db, is_mongo_available
from ..utils.security import decode_token

logger = logging.getLogger("aymo.sync_route")
router = APIRouter(prefix="/api/protected/sync", tags=["sync"])

# ─── Pydantic Models ──────────────────────────────────────────────────────────

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

# ─── Helper: Get or Create Remote Mapping ─────────────────────────────────────

async def get_or_create_remote_id(db, workspace_id: str, entity_type: str, local_id: str) -> str:
    """
    Returns the mapped remoteId (a clean UUID) for a localId.
    Creates a new mapping if none exists.
    Hides internal MongoDB ObjectIds completely.
    """
    mappings_col = db.remote_mappings
    existing = await mappings_col.find_one({
        "workspaceId": workspace_id,
        "entityType": entity_type,
        "localId": local_id
    })
    
    if existing:
        return existing["remoteId"]
        
    # Generate a fresh UUID for the remote mapping
    new_remote_id = str(uuid.uuid4())
    await mappings_col.insert_one({
        "workspaceId": workspace_id,
        "entityType": entity_type,
        "localId": local_id,
        "remoteId": new_remote_id,
        "createdAt": datetime.now(timezone.utc).isoformat()
    })
    return new_remote_id

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/push", response_model=SyncPushResponse)
async def sync_push(request: Request, body: SyncPushRequest):
    """
    Pushes a single operation from the frontend queue into MongoDB.
    """
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="MongoDB is currently offline. Please try again later.")

    workspace_id = body.workspaceId
    entity_type = body.entityType
    operation = body.operation
    local_id = body.localId
    payload = body.payload

    # Get or create the frontend-facing remote mapping
    remote_id = await get_or_create_remote_id(db, workspace_id, entity_type, local_id)

    # 1. Notes handling
    if entity_type == "note":
        col = db.notes
        if operation in ("create", "update", "restore", "rename", "duplicate"):
            # Upsert the note document using the localId as the unique match key
            doc = {
                "id": local_id,
                "workspaceId": workspace_id,
                "title": payload.get("title", ""),
                "body": payload.get("body", ""),
                "isPinned": payload.get("isPinned", False),
                "isFavorited": payload.get("isFavorited", False),
                "tags": payload.get("tags", []),
                "files": payload.get("files", []),
                "deletedAt": payload.get("deletedAt"),
                "createdAt": payload.get("createdAt", body.createdAt),
                "updatedAt": datetime.now(timezone.utc).isoformat()
            }
            await col.replace_one({"id": local_id}, doc, upsert=True)
            logger.info(f"Upserted note {local_id} with operation {operation}")

        elif operation == "delete":
            # Soft or hard delete propagation.
            is_permanent = payload.get("permanent", False)
            if is_permanent:
                # Remove document from MongoDB notes collection
                await col.delete_one({"id": local_id})
                # Add to tombstones collection
                tomb_col = db.tombstones
                await tomb_col.replace_one(
                    {"localId": local_id},
                    {
                        "workspaceId": workspace_id,
                        "entityType": entity_type,
                        "localId": local_id,
                        "remoteId": remote_id,
                        "deletedAt": datetime.now(timezone.utc).isoformat()
                    },
                    upsert=True
                )
                logger.info(f"Hard deleted note {local_id} and wrote tombstone")
            else:
                # Soft delete update
                await col.update_one(
                    {"id": local_id},
                    {"$set": {"deletedAt": datetime.now(timezone.utc).isoformat(), "updatedAt": datetime.now(timezone.utc).isoformat()}}
                )
                logger.info(f"Soft deleted note {local_id}")

    # 2. General fallback for other entity types if introduced
    else:
        col = db[f"{entity_type}s"]
        if operation in ("create", "update"):
            doc = {"id": local_id, "workspaceId": workspace_id, **payload, "updatedAt": datetime.now(timezone.utc).isoformat()}
            await col.replace_one({"id": local_id}, doc, upsert=True)
        elif operation == "delete":
            await col.delete_one({"id": local_id})

    return SyncPushResponse(remoteId=remote_id)

@router.get("/pull", response_model=SyncPullResponse)
async def sync_pull(request: Request, workspaceId: str, since: Optional[str] = None):
    """
    Pulls changes from MongoDB for a workspace since a given timestamp.
    """
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="MongoDB is currently offline. Please try again later.")

    changes = []
    
    # 1. Pull Note changes
    notes_col = db.notes
    query: Dict[str, Any] = {"workspaceId": workspaceId}
    if since:
        query["updatedAt"] = {"$gt": since}
        
    cursor = notes_col.find(query)
    async for doc in cursor:
        local_id = doc["id"]
        remote_id = await get_or_create_remote_id(db, workspaceId, "note", local_id)
        
        # Strip internal MongoDB fields (_id)
        payload = {k: v for k, v in doc.items() if k != "_id"}
        
        changes.append(SyncPullResponseItem(
            entityType="note",
            operation="update" if doc.get("deletedAt") is None else "delete",
            localId=local_id,
            remoteId=remote_id,
            payload=payload,
            updatedAt=doc.get("updatedAt", doc.get("createdAt", ""))
        ))

    # 2. Pull Tombstone changes (to notify of hard deletions)
    tomb_col = db.tombstones
    tomb_query: Dict[str, Any] = {"workspaceId": workspaceId}
    if since:
        tomb_query["deletedAt"] = {"$gt": since}
        
    tomb_cursor = tomb_col.find(tomb_query)
    async for doc in tomb_cursor:
        changes.append(SyncPullResponseItem(
            entityType=doc["entityType"],
            operation="delete",
            localId=doc["localId"],
            remoteId=doc["remoteId"],
            payload={"permanent": True},
            updatedAt=doc["deletedAt"]
        ))

    # Sort changes by updatedAt
    changes.sort(key=lambda x: x.updatedAt)
    return SyncPullResponse(changes=changes)

@router.post("/conflict", response_model=ConflictResolutionResponse)
async def resolve_conflict(body: ConflictResolutionRequest):
    """
    Implements a simple Last-Write-Wins strategy backend side.
    """
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="MongoDB is offline.")
        
    # By default, last-write-wins is resolved locally by the adapter,
    # but this endpoint is registered for interface completeness.
    return ConflictResolutionResponse(resolution="local-wins")

@router.get("/status", response_model=SyncStatusResponse)
async def sync_status():
    """
    Checks sync health.
    """
    available = is_mongo_available()
    return SyncStatusResponse(
        available=available,
        status="active" if available else "offline"
    )
