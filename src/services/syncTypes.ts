/**
 * syncTypes.ts — Phase 2: Cloud Synchronization Foundation
 *
 * All shared TypeScript interfaces and enums for the AYMO sync layer.
 * This file has zero runtime dependencies — safe to import anywhere.
 *
 * Architecture contract:
 *   IndexedDB = source of truth (always written first)
 *   MongoDB Atlas = cloud copy (written via CloudSyncAdapter in Phase 3)
 *   FastAPI = API gateway (unchanged until PostgreSQL removal)
 */

// ─── Entity Types ─────────────────────────────────────────────────────────────

/** Every entity that can be synchronized with the cloud. */
export type SyncEntityType =
  | "note"
  | "tag"
  | "preference"
  | "annotation"
  | "attachment"
  | "aiHistory"
  | "workspace";

// ─── Operations ───────────────────────────────────────────────────────────────

/** All local write operations that produce a sync queue entry. */
export type SyncOperation =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "rename"
  | "move"
  | "duplicate";

// ─── Queue Record ─────────────────────────────────────────────────────────────

export type SyncQueueStatus =
  | "pending"      // Awaiting processing
  | "processing"   // Currently being sent to the cloud
  | "synced"       // Successfully written to cloud
  | "failed"       // Last attempt failed; will be retried
  | "conflict";    // Remote version conflicts with local version

/**
 * One entry in the syncQueue IndexedDB store.
 * Represents a local write that needs to be propagated to the cloud.
 */
export interface SyncQueueRecord {
  /** UUID — primary key */
  id: string;
  /** Workspace this change belongs to */
  workspaceId: string;
  /** Type of entity that was changed */
  entityType: SyncEntityType;
  /** What happened to the entity */
  operation: SyncOperation;
  /** Local UUID of the changed entity */
  localId: string;
  /**
   * Snapshot of the entity at the time of the operation.
   * For "delete"/"restore" this may be minimal (just the id).
   * For "create"/"update" this is the full entity payload.
   */
  payload: Record<string, unknown>;
  /** When this queue entry was created (ISO-8601) */
  createdAt: string;
  /** When this queue entry was last updated (ISO-8601) */
  updatedAt: string;
  /** How many times the cloud push has been attempted */
  retryCount: number;
  /** Current lifecycle state */
  status: SyncQueueStatus;
  /** Error message from the most recent failed attempt, or null */
  lastError: string | null;
}

// ─── Remote Mapping ───────────────────────────────────────────────────────────

/**
 * Separates local UUIDs from cloud IDs.
 * Stored in the remoteMappings IndexedDB store.
 *
 * Local IDs are always primary within the application.
 * Remote IDs (MongoDB ObjectIds) are only used when communicating
 * with the cloud adapter — they never appear in React state.
 */
export interface RemoteMapping {
  /** UUID — primary key for this mapping record */
  id: string;
  workspaceId: string;
  entityType: SyncEntityType;
  /** Local UUID of the entity */
  localId: string;
  /** Cloud identifier (MongoDB ObjectId string) */
  remoteId: string;
  /** Cloud provider — always "mongodb" during Phase 3+ */
  provider: "mongodb";
  /** When this mapping was last confirmed with the cloud (ISO-8601) */
  syncedAt: string;
}

// ─── Sync State ───────────────────────────────────────────────────────────────

export type SyncStatus =
  | "disabled"             // Cloud sync not configured (local-only session)
  | "waiting_for_internet" // Device is offline; queue is paused
  | "pending_changes"      // Queue has entries; waiting to connect or rate limit
  | "syncing"              // Actively writing to cloud
  | "synced"               // All local changes are reflected in the cloud
  | "error";               // Non-recoverable error (e.g. auth failure)

/**
 * One record per workspace in the syncState IndexedDB store.
 * Tracks the overall synchronization health of a workspace.
 */
export interface SyncStateRecord {
  /** workspaceId — primary key */
  workspaceId: string;
  status: SyncStatus;
  /** ISO-8601 timestamp of the last successful full sync, or null */
  lastSyncedAt: string | null;
  /** Number of queue entries currently in "pending" or "failed" state */
  pendingCount: number;
  /** Description of the most recent error, or null */
  lastError: string | null;
  /** When this record was last written (ISO-8601) */
  updatedAt: string;
}

// ─── Tombstone ────────────────────────────────────────────────────────────────

/**
 * Written when a local entity is permanently deleted.
 * Used to propagate deletions to the cloud even if the entity's
 * queue record was already cleaned up.
 */
export interface Tombstone {
  /** UUID — primary key */
  id: string;
  workspaceId: string;
  entityType: SyncEntityType;
  /** Local UUID of the deleted entity */
  localId: string;
  /** Cloud ID, if the entity was ever synced; null if never reached the cloud */
  remoteId: string | null;
  /** When the entity was permanently deleted (ISO-8601) */
  deletedAt: string;
}

// ─── Conflict ─────────────────────────────────────────────────────────────────

export type ConflictResolution = "pending" | "local-wins" | "remote-wins" | "merged";

/**
 * Written when the cloud version of an entity diverged from the local version.
 * Resolution can be automatic (last-write-wins) or manual (future UI).
 */
export interface ConflictRecord {
  /** UUID — primary key */
  id: string;
  workspaceId: string;
  entityType: SyncEntityType;
  /** Local UUID of the conflicting entity */
  localId: string;
  /** Local snapshot at the time of detection */
  localVersion: Record<string, unknown>;
  /** Cloud snapshot at the time of detection */
  remoteVersion: Record<string, unknown>;
  /** When the conflict was first detected (ISO-8601) */
  detectedAt: string;
  /** Resolution outcome */
  resolution: ConflictResolution;
}

// ─── Cloud Adapter Interface ───────────────────────────────────────────────────

/**
 * The interface that any cloud provider must implement.
 * The MongoDB Atlas adapter will be injected in Phase 3.
 *
 * SyncService depends on this interface — not on a concrete implementation.
 * Swapping providers requires only a different adapter, no architectural changes.
 */
export interface CloudSyncAdapter {
  readonly provider: "mongodb";

  /** Returns true when the adapter can reach the cloud. */
  isAvailable(): Promise<boolean>;

  /**
   * Pushes one sync queue record to the cloud.
   * Returns the remoteId assigned by the cloud on success.
   */
  pushOperation(record: SyncQueueRecord): Promise<{ remoteId: string }>;

  /**
   * Fetches all changes the cloud has recorded since `since`.
   * Used for pulling remote-first changes (e.g. changes from another device).
   * `since` is an ISO-8601 string, or null to fetch all records.
   */
  fetchChanges(
    workspaceId: string,
    since: string | null,
  ): Promise<
    Array<{
      entityType: SyncEntityType;
      operation: SyncOperation;
      localId: string | null;
      remoteId: string;
      payload: Record<string, unknown>;
      updatedAt: string;
    }>
  >;

  /**
   * Given a conflict, returns the resolution strategy.
   * The adapter may implement last-write-wins, CRDT, or call a server resolver.
   */
  resolveConflict(conflict: ConflictRecord): Promise<Omit<ConflictResolution, "pending">>;
}

// ─── Sync Queue Stats ─────────────────────────────────────────────────────────

export interface SyncQueueStats {
  pending: number;
  processing: number;
  synced: number;
  failed: number;
  conflict: number;
  total: number;
}
