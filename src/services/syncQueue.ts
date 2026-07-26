/**
 * syncQueue.ts — Phase 2: Cloud Synchronization Foundation
 *
 * CRUD operations for the syncQueue and syncState IndexedDB stores.
 * This module is completely independent of React and UI components.
 *
 * Usage pattern:
 *   1. Local write → putLocalNote(note)
 *   2. Immediately after → enqueueSyncOperation({ entityType: "note", ... })
 *   3. SyncService drains the queue when connectivity is available.
 */

import { openLocalWorkspaceDatabase } from "./localWorkspaceDatabase";
import type {
  SyncQueueRecord,
  SyncQueueStatus,
  SyncQueueStats,
  SyncStateRecord,
  SyncStatus,
  SyncEntityType,
  SyncOperation,
} from "./syncTypes";

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

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

async function withStore<T>(
  storeName: "syncQueue" | "syncState",
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openLocalWorkspaceDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    fn(store).then(resolve).catch((err) => {
      try { tx.abort(); } catch { /* already closed */ }
      reject(err);
    });
  });
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/** Parameters required to create a new sync queue entry. */
export interface EnqueueParams {
  workspaceId: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  localId: string;
  payload: Record<string, unknown>;
}

/**
 * Records a local write in the sync queue.
 * Call this immediately after every IndexedDB write operation.
 *
 * The queue record will be picked up by SyncService when connectivity
 * is available and a CloudSyncAdapter has been registered.
 */
export async function enqueueSyncOperation(params: EnqueueParams): Promise<SyncQueueRecord> {
  const now = new Date().toISOString();
  const record: SyncQueueRecord = {
    id: uuid(),
    workspaceId: params.workspaceId,
    entityType: params.entityType,
    operation: params.operation,
    localId: params.localId,
    payload: params.payload,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    status: "pending",
    lastError: null,
  };

  await withStore("syncQueue", "readwrite", async (store) => {
    await idbRequest(store.put(record));
  });

  return record;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Returns pending and failed operations for a workspace, oldest first.
 * This is the primary read path for SyncService.
 */
export async function getPendingOperations(
  workspaceId: string,
  limit = 50,
): Promise<SyncQueueRecord[]> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readonly");
    const store = tx.objectStore("syncQueue");
    const results: SyncQueueRecord[] = [];

    // Use the compound [workspaceId, status] index to find pending records.
    // We query both "pending" and "failed" (which are eligible for retry).
    const eligibleStatuses: SyncQueueStatus[] = ["pending", "failed"];
    let remaining = eligibleStatuses.length;

    for (const status of eligibleStatuses) {
      const range = IDBKeyRange.only([workspaceId, status]);
      const req = store.index("workspaceId_status").openCursor(range, "next");

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value as SyncQueueRecord);
          cursor.continue();
        } else {
          remaining -= 1;
          if (remaining === 0) {
            // Sort combined results by createdAt ascending (oldest first).
            results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            resolve(results.slice(0, limit));
          }
        }
      };

      req.onerror = () => reject(req.error);
    }
  });
}

/**
 * Returns all queue records for a workspace (any status).
 * Used for the Workspace Health panel and debugging.
 */
export async function getAllQueueRecords(workspaceId: string): Promise<SyncQueueRecord[]> {
  const db = await openLocalWorkspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readonly");
    const index = tx.objectStore("syncQueue").index("workspaceId");
    const req = index.getAll(IDBKeyRange.only(workspaceId));
    req.onsuccess = () => resolve(req.result as SyncQueueRecord[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Status Transitions ───────────────────────────────────────────────────────

async function updateRecord(
  id: string,
  patch: Partial<SyncQueueRecord>,
): Promise<void> {
  const db = await openLocalWorkspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result as SyncQueueRecord | undefined;
      if (!existing) { resolve(); return; }

      const updated: SyncQueueRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

/** Mark a queue record as "processing" before attempting the cloud push. */
export async function markOperationProcessing(id: string): Promise<void> {
  await updateRecord(id, { status: "processing" });
}

/** Mark a queue record as successfully synced. */
export async function markOperationSynced(id: string): Promise<void> {
  await updateRecord(id, { status: "synced", lastError: null });
}

/**
 * Mark a queue record as failed.
 * Increments retryCount and stores the error message for diagnostics.
 */
export async function markOperationFailed(id: string, error: string): Promise<void> {
  const db = await openLocalWorkspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result as SyncQueueRecord | undefined;
      if (!existing) { resolve(); return; }

      const updated: SyncQueueRecord = {
        ...existing,
        status: "failed",
        retryCount: existing.retryCount + 1,
        lastError: error,
        updatedAt: new Date().toISOString(),
      };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

/** Mark a queue record as conflicted so it can be reviewed separately. */
export async function markOperationConflict(id: string): Promise<void> {
  await updateRecord(id, { status: "conflict" });
}

/**
 * Reset all "failed" records back to "pending" so they are re-attempted.
 * Call this after recovering from a transient error (e.g. reconnecting).
 */
export async function resetFailedOperations(workspaceId: string): Promise<void> {
  const failed = await getPendingOperations(workspaceId);
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");

    for (const record of failed) {
      if (record.status === "failed") {
        store.put({ ...record, status: "pending", updatedAt: new Date().toISOString() });
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Returns counts by status for a workspace.
 * Powers the Workspace Health panel and the SyncStatus computation.
 */
export async function getQueueStats(workspaceId: string): Promise<SyncQueueStats> {
  const all = await getAllQueueRecords(workspaceId);
  const stats: SyncQueueStats = {
    pending: 0, processing: 0, synced: 0, failed: 0, conflict: 0, total: all.length,
  };
  for (const r of all) {
    stats[r.status] = (stats[r.status] ?? 0) + 1;
  }
  return stats;
}

/**
 * Removes "synced" records older than `olderThanDays` days.
 * Returns the count of deleted records.
 * Run this periodically to prevent unbounded queue growth.
 */
export async function clearSyncedOperations(
  workspaceId: string,
  olderThanDays = 30,
): Promise<number> {
  const all = await getAllQueueRecords(workspaceId);
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const toDelete = all.filter((r) => r.status === "synced" && r.updatedAt < cutoff);
  if (toDelete.length === 0) return 0;

  const db = await openLocalWorkspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    for (const r of toDelete) store.delete(r.id);
    tx.oncomplete = () => resolve(toDelete.length);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Sync State ───────────────────────────────────────────────────────────────

/**
 * Reads the sync state record for a workspace.
 * Returns null if no record has been written yet.
 */
export async function getSyncState(workspaceId: string): Promise<SyncStateRecord | null> {
  return withStore("syncState", "readonly", async (store) => {
    const result = await idbRequest<SyncStateRecord | undefined>(store.get(workspaceId));
    return result ?? null;
  });
}

/**
 * Writes (upserts) the sync state record for a workspace.
 * Called by SyncService whenever the sync status changes.
 */
export async function putSyncState(record: SyncStateRecord): Promise<void> {
  await withStore("syncState", "readwrite", async (store) => {
    await idbRequest(store.put(record));
  });
}

/**
 * Derives the correct SyncStatus from queue stats and connectivity.
 * Pure function — no I/O.
 */
export function computeSyncStatus(params: {
  cloudEnabled: boolean;
  isOnline: boolean;
  stats: SyncQueueStats;
  lastError: string | null;
}): SyncStatus {
  if (!params.cloudEnabled) return "disabled";
  if (params.lastError) return "error";
  if (!params.isOnline) return "waiting_for_internet";
  if (params.stats.processing > 0) return "syncing";
  if (params.stats.pending > 0 || params.stats.failed > 0) return "pending_changes";
  return "synced";
}
