/**
 * syncService.ts — Phase 2: Cloud Synchronization Foundation
 *
 * SyncService is the central orchestrator of all cloud synchronization.
 * It is a singleton class with NO dependency on React or any UI component.
 *
 * Responsibilities:
 *   1. Drain the syncQueue when connectivity is available.
 *   2. Retry failed operations with exponential backoff.
 *   3. Pause when offline; resume automatically on reconnect.
 *   4. Emit SyncStatus changes so the UI can react (via subscription).
 *   5. Write SyncStateRecord to IndexedDB so status survives page reloads.
 *
 * Phase 3 Integration:
 *   Call syncService.registerAdapter(mongoAdapter) to enable cloud pushes.
 *   No other code changes are required — the queue and mapping layer
 *   are already wired and waiting.
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *
 *   App writes to IndexedDB
 *        │
 *        ▼
 *   enqueueSyncOperation()  ←── localNotesService wraps every write
 *        │
 *        ▼
 *   syncQueue (IndexedDB store)
 *        │
 *        ▼
 *   SyncService.processQueue()  ←── woken by connectivity events
 *        │
 *        ├── markOperationProcessing(id)
 *        ├── adapter.pushOperation(record)
 *        ├── setRemoteMapping(...)         ←── maps local UUID → remoteId
 *        └── markOperationSynced(id)
 *
 *   On conflict:
 *        ├── markOperationConflict(id)
 *        ├── write ConflictRecord to IndexedDB
 *        └── emit SyncStatus "error" until resolved
 */

import {
  getPendingOperations,
  markOperationProcessing,
  markOperationSynced,
  markOperationFailed,
  markOperationConflict,
  getQueueStats,
  putSyncState,
  getSyncState,
  computeSyncStatus,
  resetFailedOperations,
  clearSyncedOperations,
} from "./syncQueue";
import { setRemoteMapping } from "./remoteMapping";
import {
  initConnectivityService,
  isOnline,
  onConnectivityChange,
} from "./connectivityService";
import type {
  CloudSyncAdapter,
  SyncStatus,
  SyncStateRecord,
  SyncQueueRecord,
} from "./syncTypes";

// ─── Retry Policy ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;

/**
 * Exponential backoff delay in ms.
 * attempt 0 → 2s, 1 → 4s, 2 → 8s, 3 → 16s, 4 → 32s, 5+ → 60s cap
 */
function backoffDelay(retryCount: number): number {
  return Math.min(2000 * Math.pow(2, retryCount), 60_000);
}

// ─── SyncService Class ────────────────────────────────────────────────────────

export class SyncService {
  // ── Singleton ──────────────────────────────────────────────────────────────
  private static _instance: SyncService | null = null;

  static getInstance(): SyncService {
    if (!SyncService._instance) {
      SyncService._instance = new SyncService();
    }
    return SyncService._instance;
  }

  private constructor() {}

  // ── State ──────────────────────────────────────────────────────────────────
  private workspaceId: string | null = null;
  private adapter: CloudSyncAdapter | null = null;
  private _status: SyncStatus = "disabled";
  private _lastError: string | null = null;
  private _isRunning = false;
  private _processingQueue = false;
  private _queueScheduled = false;
  private _unsubscribeConnectivity: (() => void) | null = null;
  private _retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private _statusListeners = new Set<(status: SyncStatus) => void>();
  private _stateListeners = new Set<(state: Readonly<SyncStateRecord>) => void>();

  // ── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initialize the service for a specific workspace.
   * Must be called once before start().
   * Safe to call again with the same workspaceId (no-op).
   */
  async initialize(workspaceId: string): Promise<void> {
    if (this.workspaceId === workspaceId && this._isRunning) return;

    this.workspaceId = workspaceId;
    await initConnectivityService();

    // Rehydrate last known state from IndexedDB.
    const savedState = await getSyncState(workspaceId);
    if (savedState) {
      this._lastError = savedState.lastError;
    }

    // Subscribe to connectivity changes.
    if (this._unsubscribeConnectivity) {
      this._unsubscribeConnectivity();
    }
    this._unsubscribeConnectivity = onConnectivityChange((online) => {
      this._handleConnectivityChange(online);
    });
  }

  /**
   * Registers the CloudSyncAdapter that will push records to MongoDB.
   * Called in Phase 3 when the MongoDB adapter is implemented.
   *
   * Before an adapter is registered, SyncService accumulates queue entries
   * but does not push them. The moment an adapter is registered, processing
   * begins automatically if the device is online.
   */
  registerAdapter(adapter: CloudSyncAdapter): void {
    this.adapter = adapter;
    this._log("Adapter registered:", adapter.provider);

    // If we're already running, kick off a queue pass immediately.
    if (this._isRunning && isOnline()) {
      this._scheduleQueuePass(0);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the sync service.
   * Sets up the processing loop and begins draining the queue.
   */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this._log("SyncService started");

    if (this.adapter && isOnline()) {
      this._scheduleQueuePass(0);
    } else if (!this.adapter) {
      this._setStatus("disabled");
    } else {
      this._setStatus("waiting_for_internet");
    }
  }

  /**
   * Pause the sync service.
   * In-flight operations will complete; no new operations will be started.
   */
  pause(): void {
    this._isRunning = false;
    this._clearAllRetryTimeouts();
    this._log("SyncService paused");
  }

  /**
   * Tear down the service (cleanup event listeners, timeouts).
   * Call when the workspace changes or the app unmounts.
   */
  destroy(): void {
    this.pause();
    if (this._unsubscribeConnectivity) {
      this._unsubscribeConnectivity();
      this._unsubscribeConnectivity = null;
    }
    this._statusListeners.clear();
    this._stateListeners.clear();
    this._log("SyncService destroyed");
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): SyncStatus {
    return this._status;
  }

  getLastError(): string | null {
    return this._lastError;
  }

  /**
   * Subscribe to status changes.
   * @returns Unsubscribe function.
   */
  onStatusChange(handler: (status: SyncStatus) => void): () => void {
    this._statusListeners.add(handler);
    // Immediately emit current status.
    handler(this._status);
    return () => this._statusListeners.delete(handler);
  }

  /**
   * Subscribe to full state record changes (includes pendingCount, lastSyncedAt).
   * @returns Unsubscribe function.
   */
  onStateChange(handler: (state: Readonly<SyncStateRecord>) => void): () => void {
    this._stateListeners.add(handler);
    return () => this._stateListeners.delete(handler);
  }

  // ── Queue Processing ───────────────────────────────────────────────────────

  private _scheduleQueuePass(delayMs: number): void {
    if (this._queueScheduled) return;
    this._queueScheduled = true;
    setTimeout(() => {
      this._queueScheduled = false;
      void this._processQueue();
    }, delayMs);
  }

  /**
   * Main queue processing loop.
   * Processes one batch of pending operations per invocation.
   * Schedules itself again if there are remaining entries.
   */
  private async _processQueue(): Promise<void> {
    if (!this._isRunning || !this.adapter || this._processingQueue) return;
    if (!isOnline()) {
      this._setStatus("waiting_for_internet");
      return;
    }

    const { workspaceId, adapter } = this;
    if (!workspaceId) return;

    this._processingQueue = true;

    try {
      const records = await getPendingOperations(workspaceId, 10 /* batch size */);

      if (records.length === 0) {
        // Queue is empty — confirm with stats and mark synced.
        await this._refreshStatus();
        return;
      }

      this._setStatus("syncing");

      for (const record of records) {
        if (!this._isRunning) break;
        await this._processRecord(adapter, record);
      }

      // Check if there are more records waiting.
      const stats = await getQueueStats(workspaceId);
      if (stats.pending > 0 || stats.failed > 0) {
        this._scheduleQueuePass(200); // Process next batch shortly.
      } else {
        await this._refreshStatus();
      }

      // Periodically clean up old synced records (on every 10th pass).
      if (Math.random() < 0.1) {
        await clearSyncedOperations(workspaceId, 30);
      }
    } finally {
      this._processingQueue = false;
    }
  }

  /**
   * Processes a single queue record.
   * On success: marks synced and stores the remote mapping.
   * On failure: marks failed and schedules a retry with backoff.
   * On conflict: marks conflict and emits an error status.
   */
  private async _processRecord(
    adapter: CloudSyncAdapter,
    record: SyncQueueRecord,
  ): Promise<void> {
    if (record.retryCount >= MAX_RETRIES) {
      this._log(`Giving up on record ${record.id} after ${record.retryCount} retries`);
      await markOperationConflict(record.id);
      return;
    }

    await markOperationProcessing(record.id);

    try {
      const { remoteId } = await adapter.pushOperation(record);

      // Success: store the local ↔ remote ID mapping.
      await setRemoteMapping(
        record.workspaceId,
        record.entityType,
        record.localId,
        remoteId,
      );

      await markOperationSynced(record.id);
      this._log(`Synced ${record.entityType} ${record.localId} → ${remoteId}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._log(`Failed to sync record ${record.id}:`, errorMessage);
      await markOperationFailed(record.id, errorMessage);

      // Schedule a retry with exponential backoff.
      const delay = backoffDelay(record.retryCount);
      this._scheduleRetry(record.id, delay);
    }
  }

  private _scheduleRetry(recordId: string, delayMs: number): void {
    if (this._retryTimeouts.has(recordId)) return;
    const tid = setTimeout(() => {
      this._retryTimeouts.delete(recordId);
      if (this._isRunning && isOnline()) {
        this._scheduleQueuePass(0);
      }
    }, delayMs);
    this._retryTimeouts.set(recordId, tid);
  }

  private _clearAllRetryTimeouts(): void {
    for (const tid of this._retryTimeouts.values()) {
      clearTimeout(tid);
    }
    this._retryTimeouts.clear();
  }

  // ── Connectivity Handling ──────────────────────────────────────────────────

  private _handleConnectivityChange(online: boolean): void {
    this._log("Connectivity changed:", online ? "online" : "offline");

    if (!online) {
      this._setStatus("waiting_for_internet");
      this._clearAllRetryTimeouts();
      return;
    }

    if (!this._isRunning || !this.adapter) return;

    // We're back online — reset previously failed operations so they're retried.
    if (this.workspaceId) {
      void resetFailedOperations(this.workspaceId).then(() => {
        this._scheduleQueuePass(1000); // Wait 1s after reconnect for stability.
      });
    }
  }

  // ── Internal Helpers ───────────────────────────────────────────────────────

  private async _refreshStatus(): Promise<void> {
    if (!this.workspaceId) return;

    const stats = await getQueueStats(this.workspaceId);
    const status = computeSyncStatus({
      cloudEnabled: this.adapter !== null,
      isOnline: isOnline(),
      stats,
      lastError: this._lastError,
    });
    this._setStatus(status);

    const now = new Date().toISOString();
    const stateRecord: SyncStateRecord = {
      workspaceId: this.workspaceId,
      status,
      lastSyncedAt: status === "synced" ? now : null,
      pendingCount: stats.pending + stats.failed,
      lastError: this._lastError,
      updatedAt: now,
    };

    await putSyncState(stateRecord);

    for (const listener of this._stateListeners) {
      try { listener(stateRecord); } catch { /* ignore */ }
    }
  }

  private _setStatus(status: SyncStatus): void {
    if (status === this._status) return;
    this._status = status;
    this._log("Status →", status);

    for (const listener of this._statusListeners) {
      try { listener(status); } catch { /* ignore */ }
    }

    if (this.workspaceId) {
      void putSyncState({
        workspaceId: this.workspaceId,
        status,
        lastSyncedAt: status === "synced" ? new Date().toISOString() : null,
        pendingCount: 0, // Approximate; refreshed by _refreshStatus().
        lastError: status === "error" ? this._lastError : null,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private _log(...args: unknown[]): void {
    if (import.meta.env.DEV) {
      console.debug("[SyncService]", ...args);
    }
  }
}

// ─── Module-Level Singleton Access ────────────────────────────────────────────

/** The global SyncService instance. Import this where you need sync access. */
export const syncService = SyncService.getInstance();

/** Convenience: current sync status (reactive via onStatusChange). */
export function getSyncStatus(): SyncStatus {
  return syncService.getStatus();
}
