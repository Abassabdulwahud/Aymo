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

// ─── Task 5: Crash Recovery ───────────────────────────────────────────────────

/**
 * Resets all "processing" records back to "pending".
 *
 * CRITICAL: Call this in SyncService.initialize() on every startup.
 *
 * If the browser closes while a record is being pushed to the cloud, that
 * record is left permanently in "processing" state. getPendingOperations()
 * only returns "pending" and "failed" — so without this recovery step, those
 * records would be stuck forever and never reach the cloud.
 *
 * This is safe: "processing" records have not been confirmed by the cloud,
 * so treating them as "pending" and re-pushing them is idempotent as long as
 * the MongoDB adapter uses upsert semantics (which it must).
 *
 * @returns Number of records recovered.
 */
export async function recoverStuckOperations(workspaceId: string): Promise<number> {
  const db = await openLocalWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const index = store.index("workspaceId_status");

    // Query records with status "processing" for this workspace.
    const range = IDBKeyRange.only([workspaceId, "processing"]);
    const req = index.openCursor(range);
    const now = new Date().toISOString();
    let count = 0;

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const record = cursor.value as SyncQueueRecord;
        cursor.update({
          ...record,
          status: "pending",
          updatedAt: now,
          // Note: we do NOT reset retryCount here — if this was a genuine
          // retry that crashed mid-flight, it already consumed an attempt.
        } satisfies SyncQueueRecord);
        count += 1;
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Task 1: Queue Compaction ─────────────────────────────────────────────────

/**
 * Collapses redundant "update" operations for the same entity into a single
 * record before a sync pass begins.
 *
 * RULES (strictly enforced):
 *   ✓ Only "pending" records are considered.
 *   ✓ Only "update" operations are compacted.
 *   ✓ create / delete / restore / rename / move / duplicate are NEVER compacted.
 *   ✓ An entity is only compacted when ALL its pending operations are "update".
 *     (If there's a pending delete, rename, or create, that entity is skipped.)
 *   ✓ The newest "update" record (by createdAt) is kept.
 *   ✓ The ordering of other entities in the queue is unaffected.
 *
 * WHY "all-updates" gate?
 *   Consider: update-1, restore, update-2 for the same note.
 *   Compacting update-1 and update-2 would remove history before the restore.
 *   The safe invariant: only compact when the complete pending history for an
 *   entity consists solely of updates (i.e., the note's state has been
 *   monotonically modified with no lifecycle events in between).
 *
 * @returns Number of redundant records removed.
 */
export async function compactQueue(workspaceId: string): Promise<number> {
  const all = await getAllQueueRecords(workspaceId);

  // Only consider "pending" records — do not touch failed/processing/synced/conflict.
  const pending = all.filter((r) => r.status === "pending");

  if (pending.length === 0) return 0;

  // Group pending records by localId.
  const byLocalId = new Map<string, SyncQueueRecord[]>();
  for (const record of pending) {
    const group = byLocalId.get(record.localId) ?? [];
    group.push(record);
    byLocalId.set(record.localId, group);
  }

  const toDelete: string[] = [];

  for (const [, records] of byLocalId) {
    // Must have more than one record to compact.
    if (records.length <= 1) continue;

    // All pending operations for this entity must be "update".
    // If there's a create, delete, restore, rename, etc., skip this entity.
    const allUpdates = records.every((r) => r.operation === "update");
    if (!allUpdates) continue;

    // Sort by createdAt ascending so the LAST element is the newest.
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Keep the newest (index length-1), mark all others for deletion.
    for (let i = 0; i < records.length - 1; i++) {
      toDelete.push(records[i].id);
    }
  }

  if (toDelete.length === 0) return 0;

  const db = await openLocalWorkspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    for (const id of toDelete) store.delete(id);
    tx.oncomplete = () => resolve(toDelete.length);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Task 3: Queue Integrity Report ──────────────────────────────────────────

export interface QueueIntegrityReport {
  workspaceId: string;
  checkedAt: string;
  /** Any "processing" records found — should always be 0 after initialize(). */
  stuckProcessing: number;
  /** Duplicate "update" records for the same localId (compactable). */
  compactableUpdates: number;
  /** Total pending + failed records awaiting sync. */
  awaitingSync: number;
  /** Any "conflict" records requiring manual resolution. */
  conflicts: number;
  /** Overall assessment. */
  healthy: boolean;
  notes: string[];
}

/**
 * Performs a non-destructive health check of the sync queue for a workspace.
 * Returns a structured report that can be surfaced in the Workspace Health panel.
 *
 * Does NOT modify any records.
 */
export async function checkQueueIntegrity(workspaceId: string): Promise<QueueIntegrityReport> {
  const all = await getAllQueueRecords(workspaceId);
  const notes: string[] = [];

  const stuckProcessing = all.filter((r) => r.status === "processing").length;
  if (stuckProcessing > 0) {
    notes.push(`${stuckProcessing} record(s) stuck in "processing" — call recoverStuckOperations() to fix.`);
  }

  // Count compactable duplicates.
  const pending = all.filter((r) => r.status === "pending");
  const byLocalId = new Map<string, SyncQueueRecord[]>();
  for (const r of pending) {
    const g = byLocalId.get(r.localId) ?? [];
    g.push(r);
    byLocalId.set(r.localId, g);
  }
  let compactableUpdates = 0;
  for (const [, records] of byLocalId) {
    if (records.length > 1 && records.every((r) => r.operation === "update")) {
      compactableUpdates += records.length - 1;
    }
  }
  if (compactableUpdates > 0) {
    notes.push(`${compactableUpdates} redundant update record(s) can be compacted before next sync.`);
  }

  const awaitingSync = all.filter((r) => r.status === "pending" || r.status === "failed").length;
  const conflicts = all.filter((r) => r.status === "conflict").length;
  if (conflicts > 0) {
    notes.push(`${conflicts} conflict(s) require manual resolution.`);
  }

  const healthy = stuckProcessing === 0 && conflicts === 0;
  if (healthy && notes.length === 0) {
    notes.push("Queue is healthy.");
  }

  return {
    workspaceId,
    checkedAt: new Date().toISOString(),
    stuckProcessing,
    compactableUpdates,
    awaitingSync,
    conflicts,
    healthy,
    notes,
  };
}

