"""
MongoDB Atlas Repository Layer for AYMO.
Provides type-safe, strictly scoped database access for all collections.
Guarantees multi-tenant isolation: every query checks user_id / workspace_id.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..models.mongo_models import (
    UserDoc,
    WorkspaceDoc,
    NoteDoc,
    FileDoc,
    AnnotationDoc,
    AiCacheDoc,
    RemoteMappingDoc,
    TombstoneDoc,
    utc_now_iso,
)

logger = logging.getLogger("aymo.mongo_repository")


# ─── User Repository ───────────────────────────────────────────────────────────

class UserMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.col = db.users

    async def get_by_id(self, user_id: str) -> Optional[UserDoc]:
        doc = await self.col.find_one({"_id": user_id})
        if not doc:
            return None
        return UserDoc(**doc)

    async def get_by_email(self, email: str) -> Optional[UserDoc]:
        doc = await self.col.find_one({"email": email.lower().strip()})
        if not doc:
            return None
        return UserDoc(**doc)

    async def create(self, user: UserDoc) -> UserDoc:
        doc = user.model_dump(by_alias=True)
        await self.col.insert_one(doc)
        return user

    async def update_last_login(self, user_id: str) -> None:
        await self.col.update_one(
            {"_id": user_id},
            {"$set": {"last_login_at": utc_now_iso()}}
        )

    async def update_preferences(
        self,
        user_id: str,
        theme: Optional[str] = None,
        language: Optional[str] = None,
        ai_provider: Optional[str] = None
    ) -> Optional[UserDoc]:
        updates: Dict[str, Any] = {}
        if theme is not None:
            updates["preferred_theme"] = theme
        if language is not None:
            updates["preferred_language"] = language
        if ai_provider is not None:
            updates["preferred_ai_provider"] = ai_provider

        if updates:
            await self.col.update_one({"_id": user_id}, {"$set": updates})

        return await self.get_by_id(user_id)


# ─── Workspace Repository ──────────────────────────────────────────────────────

class WorkspaceMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.col = db.workspaces

    async def get_by_id(self, workspace_id: str) -> Optional[WorkspaceDoc]:
        doc = await self.col.find_one({"_id": workspace_id})
        if not doc:
            return None
        return WorkspaceDoc(**doc)

    async def is_owner(self, workspace_id: str, user_id: str) -> bool:
        doc = await self.col.find_one({"_id": workspace_id})
        if not doc:
            return False
        return doc.get("owner_user_id") == user_id

    async def register_workspace(
        self,
        workspace_id: str,
        owner_user_id: str,
        name: str = "Default Workspace"
    ) -> WorkspaceDoc:
        """
        Registers a workspace to an authenticated user.
        Idempotent: succeeding if already owned by this user.
        Raises ValueError if workspace is owned by another user.
        """
        existing = await self.col.find_one({"_id": workspace_id})
        if existing:
            if existing.get("owner_user_id") == owner_user_id:
                return WorkspaceDoc(**existing)
            else:
                logger.warning(
                    f"[AUTH] User {owner_user_id} attempted to claim workspace {workspace_id} "
                    f"owned by {existing.get('owner_user_id')}"
                )
                raise ValueError("Workspace is owned by another user.")

        now = utc_now_iso()
        ws_doc = WorkspaceDoc(
            id=workspace_id,
            owner_user_id=owner_user_id,
            name=name,
            created_at=now,
            updated_at=now,
        )
        doc = ws_doc.model_dump(by_alias=True)
        await self.col.insert_one(doc)
        logger.info(f"[WORKSPACE] Registered workspace {workspace_id} to user {owner_user_id}")
        return ws_doc


# ─── Note Repository ───────────────────────────────────────────────────────────

class NoteMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.col = db.notes

    async def get_by_id(self, note_id: str, user_id: str) -> Optional[NoteDoc]:
        doc = await self.col.find_one({"_id": note_id, "user_id": user_id})
        if not doc:
            return None
        return NoteDoc(**doc)

    async def list_notes(
        self,
        user_id: str,
        workspace_id: Optional[str] = None,
        search: Optional[str] = None,
        pinned: Optional[bool] = None,
        favorited: Optional[bool] = None,
        tag: Optional[str] = None,
        include_deleted: bool = False
    ) -> List[NoteDoc]:
        query: Dict[str, Any] = {"user_id": user_id}

        if workspace_id:
            query["workspace_id"] = workspace_id

        if not include_deleted:
            query["deleted_at"] = None

        if pinned is not None:
            query["is_pinned"] = pinned

        if favorited is not None:
            query["is_favorited"] = favorited

        if tag:
            query["tags"] = tag

        if search:
            regex_search = {"$regex": search.strip(), "$options": "i"}
            query["$or"] = [{"title": regex_search}, {"body": regex_search}]

        cursor = self.col.find(query).sort("updated_at", -1)
        notes: List[NoteDoc] = []
        async for doc in cursor:
            notes.append(NoteDoc(**doc))
        return notes

    async def upsert_note(self, note: NoteDoc, user_id: str) -> NoteDoc:
        """
        Upserts note ensuring user ownership. Increments version on update.
        """
        existing = await self.get_by_id(note.id, user_id)
        if not existing:
            # Check if note exists under a different user_id
            any_existing = await self.col.find_one({"_id": note.id})
            if any_existing and any_existing.get("user_id") != user_id:
                raise ValueError("You do not have permission to overwrite this note.")

        doc = note.model_dump(by_alias=True)
        doc["user_id"] = user_id
        doc["updated_at"] = utc_now_iso()

        if existing:
            doc["version"] = existing.version + 1
            await self.col.replace_one({"_id": note.id, "user_id": user_id}, doc, upsert=False)
            note.version = doc["version"]
        else:
            doc["version"] = max(note.version, 1)
            await self.col.replace_one({"_id": note.id}, doc, upsert=True)

        note.updated_at = doc["updated_at"]
        return note

    async def soft_delete(self, note_id: str, user_id: str) -> bool:
        now = utc_now_iso()
        res = await self.col.update_one(
            {"_id": note_id, "user_id": user_id},
            {"$set": {"deleted_at": now, "updated_at": now}}
        )
        return res.modified_count > 0

    async def restore(self, note_id: str, user_id: str) -> Optional[NoteDoc]:
        now = utc_now_iso()
        res = await self.col.update_one(
            {"_id": note_id, "user_id": user_id},
            {"$set": {"deleted_at": None, "updated_at": now}}
        )
        if res.modified_count > 0:
            return await self.get_by_id(note_id, user_id)
        return None

    async def hard_delete(self, note_id: str, user_id: str) -> bool:
        res = await self.col.delete_one({"_id": note_id, "user_id": user_id})
        return res.deleted_count > 0

    async def list_trash(self, user_id: str, search: Optional[str] = None) -> List[NoteDoc]:
        query: Dict[str, Any] = {
            "user_id": user_id,
            "deleted_at": {"$ne": None}
        }
        if search:
            regex_search = {"$regex": search.strip(), "$options": "i"}
            query["$or"] = [{"title": regex_search}, {"body": regex_search}]

        cursor = self.col.find(query).sort("updated_at", -1)
        notes: List[NoteDoc] = []
        async for doc in cursor:
            notes.append(NoteDoc(**doc))
        return notes

    async def empty_trash(self, user_id: str) -> int:
        res = await self.col.delete_many({
            "user_id": user_id,
            "deleted_at": {"$ne": None}
        })
        return res.deleted_count


# ─── File / Attachment Repository ──────────────────────────────────────────────

class FileMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.col = db.files

    async def get_by_id(self, file_id: str, user_id: str) -> Optional[FileDoc]:
        doc = await self.col.find_one({"_id": file_id, "user_id": user_id})
        if not doc:
            return None
        return FileDoc(**doc)

    async def list_for_note(self, note_id: str, user_id: str) -> List[FileDoc]:
        cursor = self.col.find({"note_id": note_id, "user_id": user_id}).sort("uploaded_at", -1)
        files: List[FileDoc] = []
        async for doc in cursor:
            files.append(FileDoc(**doc))
        return files

    async def create_or_replace(self, file_doc: FileDoc, user_id: str) -> FileDoc:
        doc = file_doc.model_dump(by_alias=True)
        doc["user_id"] = user_id
        await self.col.replace_one({"_id": file_doc.id, "user_id": user_id}, doc, upsert=True)
        return file_doc

    async def update_extraction_status(
        self,
        file_id: str,
        user_id: str,
        status: str,
        extracted_text: Optional[str] = None,
        error: Optional[str] = None,
        progress: Optional[int] = None,
        steps: Optional[str] = None
    ) -> bool:
        updates: Dict[str, Any] = {"extraction_status": status}
        if extracted_text is not None:
            updates["extracted_text"] = extracted_text
        if error is not None:
            updates["extraction_error"] = error
        if progress is not None:
            updates["progress_percent"] = progress
        if steps is not None:
            updates["detailed_steps"] = steps

        res = await self.col.update_one(
            {"_id": file_id, "user_id": user_id},
            {"$set": updates}
        )
        return res.modified_count > 0

    async def delete(self, file_id: str, user_id: str) -> bool:
        res = await self.col.delete_one({"_id": file_id, "user_id": user_id})
        return res.deleted_count > 0


# ─── Annotation Repository ─────────────────────────────────────────────────────

class AnnotationMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.col = db.annotations

    async def list_annotations(
        self,
        user_id: str,
        source_type: Optional[str] = None,
        source_id: Optional[str] = None,
        page_number: Optional[int] = None
    ) -> List[AnnotationDoc]:
        query: Dict[str, Any] = {"user_id": user_id}
        if source_type:
            query["source_type"] = source_type
        if source_id:
            query["source_id"] = source_id
        if page_number is not None:
            query["page_number"] = page_number

        cursor = self.col.find(query).sort("created_at", 1)
        annotations: List[AnnotationDoc] = []
        async for doc in cursor:
            annotations.append(AnnotationDoc(**doc))
        return annotations

    async def create(self, annotation: AnnotationDoc, user_id: str) -> AnnotationDoc:
        doc = annotation.model_dump(by_alias=True)
        doc["user_id"] = user_id
        await self.col.insert_one(doc)
        return annotation

    async def update(self, annotation_id: str, user_id: str, patch: Dict[str, Any]) -> Optional[AnnotationDoc]:
        patch["updated_at"] = utc_now_iso()
        await self.col.update_one(
            {"_id": annotation_id, "user_id": user_id},
            {"$set": patch}
        )
        doc = await self.col.find_one({"_id": annotation_id, "user_id": user_id})
        if doc:
            return AnnotationDoc(**doc)
        return None

    async def delete(self, annotation_id: str, user_id: str) -> bool:
        res = await self.col.delete_one({"_id": annotation_id, "user_id": user_id})
        return res.deleted_count > 0


# ─── Sync & Mapping Repository ─────────────────────────────────────────────────

class SyncMongoRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.mappings_col = db.remote_mappings
        self.tombstones_col = db.tombstones

    async def get_or_create_remote_id(
        self,
        workspace_id: str,
        entity_type: str,
        local_id: str,
        user_id: str
    ) -> str:
        existing = await self.mappings_col.find_one({
            "workspace_id": workspace_id,
            "entity_type": entity_type,
            "local_id": local_id
        })
        if existing:
            if existing.get("user_id") and existing["user_id"] != user_id:
                raise ValueError("Mapping belongs to another user.")
            return existing["remote_id"]

        new_remote_id = str(uuid.uuid4())
        await self.mappings_col.insert_one({
            "workspace_id": workspace_id,
            "entity_type": entity_type,
            "local_id": local_id,
            "remote_id": new_remote_id,
            "user_id": user_id,
            "created_at": utc_now_iso()
        })
        return new_remote_id

    async def create_tombstone(
        self,
        workspace_id: str,
        entity_type: str,
        local_id: str,
        remote_id: str,
        user_id: str
    ) -> None:
        await self.tombstones_col.replace_one(
            {"workspace_id": workspace_id, "local_id": local_id, "user_id": user_id},
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "entity_type": entity_type,
                "local_id": local_id,
                "remote_id": remote_id,
                "deleted_at": utc_now_iso()
            },
            upsert=True
        )

    async def get_tombstones_since(
        self,
        workspace_id: str,
        user_id: str,
        since: Optional[str] = None
    ) -> List[TombstoneDoc]:
        query: Dict[str, Any] = {"workspace_id": workspace_id, "user_id": user_id}
        if since:
            query["deleted_at"] = {"$gt": since}

        cursor = self.tombstones_col.find(query).sort("deleted_at", 1)
        tombstones: List[TombstoneDoc] = []
        async for doc in cursor:
            tombstones.append(TombstoneDoc(**doc))
        return tombstones
