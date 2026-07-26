/**
 * remoteMapping.ts — Phase 2: Cloud Synchronization Foundation
 *
 * Manages the mapping between local UUIDs and cloud IDs (MongoDB ObjectIds).
 *
 * ARCHITECTURAL CONTRACT:
 *   - Local UUIDs are ALWAYS primary within the application.
 *   - Remote IDs exist ONLY in this mapping layer and the syncQueue payload.
 *   - React state, IndexedDB stores, and the URL router never use remote IDs.
 *   - The MongoDB adapter reads remote IDs from here; it never writes local IDs
 *     into application-level data.
 *
 * This decoupling means AYMO can migrate cloud providers (Mongo → Firestore,
 * etc.) without touching the application layer.
 */

import { openLocalWorkspaceDatabase } from "./localWorkspaceDatabase";
import type { RemoteMapping, SyncEntityType } from "./syncTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Creates or updates the remote mapping for a local entity.
 * Called by SyncService after the cloud acknowledges a push.
 *
 * @param workspaceId  - The workspace this entity belongs to
 * @param entityType   - e.g. "note", "tag"
 * @param localId      - Local UUID (the source of truth ID)
 * @param remoteId     - MongoDB ObjectId string returned by the cloud
 */
export async function setRemoteMapping(
  workspaceId: string,
  entityType: SyncEntityType,
  localId: string,
  remoteId: string,
): Promise<RemoteMapping> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("remoteMappings", "readwrite");
    const store = tx.objectStore("remoteMappings");

    // Check if a mapping already exists for this localId.
    const index = store.index("localId");
    const getReq = index.get(localId);

    getReq.onsuccess = () => {
      const existing = getReq.result as RemoteMapping | undefined;
      const now = new Date().toISOString();

      const mapping: RemoteMapping = existing
        ? { ...existing, remoteId, syncedAt: now }
        : {
            id: uuid(),
            workspaceId,
            entityType,
            localId,
            remoteId,
            provider: "mongodb",
            syncedAt: now,
          };

      const putReq = store.put(mapping);
      putReq.onsuccess = () => resolve(mapping);
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns the remote mapping for a local entity, or null if it has
 * never been synced to the cloud.
 */
export async function getRemoteMapping(
  _workspaceId: string,
  _entityType: SyncEntityType,
  localId: string,
): Promise<RemoteMapping | null> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("remoteMappings", "readonly");
    const index = tx.objectStore("remoteMappings").index("localId");
    const req = index.get(localId);
    req.onsuccess = () => resolve((req.result as RemoteMapping | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Reverse lookup: given a cloud ID, returns the local UUID.
 * Used when pulling changes from the cloud to apply them locally.
 */
export async function getLocalIdByRemoteId(
  _workspaceId: string,
  _entityType: SyncEntityType,
  remoteId: string,
): Promise<string | null> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("remoteMappings", "readonly");
    const index = tx.objectStore("remoteMappings").index("remoteId");
    const req = index.get(remoteId);
    req.onsuccess = () => {
      const mapping = req.result as RemoteMapping | undefined;
      resolve(mapping?.localId ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns all remote mappings for a workspace.
 * Used by SyncService during a full pull to reconcile local vs. cloud state.
 */
export async function listRemoteMappings(
  workspaceId: string,
  entityType?: SyncEntityType,
): Promise<RemoteMapping[]> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("remoteMappings", "readonly");
    const index = tx.objectStore("remoteMappings").index("workspaceId");
    const req = index.getAll(IDBKeyRange.only(workspaceId));
    req.onsuccess = () => {
      const all = req.result as RemoteMapping[];
      resolve(entityType ? all.filter((m) => m.entityType === entityType) : all);
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Removes the remote mapping for a local entity.
 * Called when an entity is permanently deleted and the cloud has
 * confirmed the deletion (before writing the tombstone).
 */
export async function deleteRemoteMapping(
  _workspaceId: string,
  _entityType: SyncEntityType,
  localId: string,
): Promise<void> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("remoteMappings", "readwrite");
    const store = tx.objectStore("remoteMappings");
    const index = store.index("localId");
    const getReq = index.get(localId);

    getReq.onsuccess = () => {
      const mapping = getReq.result as RemoteMapping | undefined;
      if (!mapping) { resolve(); return; }
      const delReq = store.delete(mapping.id);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

// ─── Tombstones ───────────────────────────────────────────────────────────────

/**
 * Writes a tombstone for a permanently deleted entity.
 * Tombstones allow the cloud to be notified of deletions even if the
 * entity's syncQueue record has already been cleaned up.
 */
export async function writeTombstone(params: {
  workspaceId: string;
  entityType: SyncEntityType;
  localId: string;
  remoteId: string | null;
}): Promise<void> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("tombstones", "readwrite");
    const store = tx.objectStore("tombstones");
    store.put({
      id: uuid(),
      workspaceId: params.workspaceId,
      entityType: params.entityType,
      localId: params.localId,
      remoteId: params.remoteId,
      deletedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
