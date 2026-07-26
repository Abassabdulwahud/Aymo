/**
 * localNotesService.ts — Phase 2: Cloud Synchronization Foundation
 *
 * The integration layer between the IndexedDB note store and the sync queue.
 *
 * RULE: All note write operations must go through this service.
 * This guarantees that every local change is automatically enqueued for
 * cloud synchronization without requiring callers to think about it.
 *
 * Pattern:
 *   1. Write to IndexedDB (source of truth — always succeeds first)
 *   2. Enqueue sync operation (best-effort — non-blocking, logged on failure)
 *
 * The two steps are NOT in the same IndexedDB transaction intentionally.
 * If the queue write fails, the note is still saved. A reconciliation pass
 * (scanning notes vs. queue) can recover orphaned entries in Phase 3.
 *
 * Read operations are NOT wrapped here — import them directly from
 * localWorkspaceDatabase.ts (listLocalNotes, getLocalNote, etc.).
 */

import {
  putLocalNote,
  deleteLocalNotePermanently,
  generateUuid,
  type LocalNote,
} from "./localWorkspaceDatabase";
import { enqueueSyncOperation } from "./syncQueue";
import { writeTombstone, deleteRemoteMapping, getRemoteMapping } from "./remoteMapping";
import type { SyncOperation } from "./syncTypes";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Silently enqueue a sync operation — never throws, never blocks the caller. */
async function enqueueQuietly(
  workspaceId: string,
  operation: SyncOperation,
  localId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await enqueueSyncOperation({ workspaceId, entityType: "note", operation, localId, payload });
  } catch (err) {
    // Sync queue failure must never surface as a note-save failure.
    if (import.meta.env.DEV) {
      console.warn("[localNotesService] Failed to enqueue sync operation:", err);
    }
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Creates a new note in IndexedDB and enqueues a "create" sync operation.
 *
 * @param workspaceId - The workspace this note belongs to
 * @param fields      - Note fields (title, body, tags, etc.)
 * @returns           - The created LocalNote with auto-assigned id
 */
export async function createNote(
  workspaceId: string,
  fields: Omit<LocalNote, "id" | "workspaceId" | "createdAt" | "updatedAt">,
): Promise<LocalNote> {
  const now = new Date().toISOString();
  const note: LocalNote = {
    id: generateUuid(),
    workspaceId,
    ...fields,
    createdAt: now,
    updatedAt: now,
  };

  await putLocalNote(note);
  void enqueueQuietly(workspaceId, "create", note.id, noteToPayload(note));

  return note;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Updates an existing note in IndexedDB and enqueues an "update" sync operation.
 * Pass the full note object with the fields you wish to update already applied.
 */
export async function updateNote(
  note: LocalNote,
  operation: Extract<SyncOperation, "update" | "rename"> = "update",
): Promise<LocalNote> {
  const updated: LocalNote = { ...note, updatedAt: new Date().toISOString() };
  await putLocalNote(updated);
  void enqueueQuietly(note.workspaceId, operation, note.id, noteToPayload(updated));
  return updated;
}

// ─── Soft Delete (Trash) ──────────────────────────────────────────────────────

/**
 * Moves a note to trash by setting deletedAt.
 * Enqueues a "delete" sync operation so the cloud mirrors the trash state.
 */
export async function trashNote(note: LocalNote): Promise<LocalNote> {
  const now = new Date().toISOString();
  const trashed: LocalNote = { ...note, deletedAt: now, updatedAt: now };
  await putLocalNote(trashed);
  void enqueueQuietly(note.workspaceId, "delete", note.id, { id: note.id, deletedAt: now });
  return trashed;
}

// ─── Restore from Trash ───────────────────────────────────────────────────────

/**
 * Restores a trashed note by clearing deletedAt.
 * Enqueues a "restore" sync operation.
 */
export async function restoreNote(note: LocalNote): Promise<LocalNote> {
  const now = new Date().toISOString();
  const restored: LocalNote = { ...note, deletedAt: null, updatedAt: now };
  await putLocalNote(restored);
  void enqueueQuietly(note.workspaceId, "restore", note.id, noteToPayload(restored));
  return restored;
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

/**
 * Creates a copy of an existing note with a new UUID.
 * Enqueues a "duplicate" sync operation for the new note.
 */
export async function duplicateNote(source: LocalNote): Promise<LocalNote> {
  const now = new Date().toISOString();
  const copy: LocalNote = {
    ...source,
    id: generateUuid(),
    title: `${source.title} (copy)`,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
  };

  await putLocalNote(copy);
  void enqueueQuietly(source.workspaceId, "duplicate", copy.id, {
    ...noteToPayload(copy),
    sourceLocalId: source.id,
  });

  return copy;
}

// ─── Permanent Delete ─────────────────────────────────────────────────────────

/**
 * Permanently removes a note from IndexedDB.
 * Writes a tombstone and enqueues a "delete" sync operation so the cloud
 * can remove the document in Phase 3.
 *
 * The tombstone persists even after the note record is gone, ensuring
 * the cloud deletion can be propagated on next sync.
 */
export async function permanentlyDeleteNote(note: LocalNote): Promise<void> {
  const remoteMapping = await getRemoteMapping(note.workspaceId, "note", note.id);

  await deleteLocalNotePermanently(note.id);

  // Write tombstone before removing the remote mapping.
  await writeTombstone({
    workspaceId: note.workspaceId,
    entityType: "note",
    localId: note.id,
    remoteId: remoteMapping?.remoteId ?? null,
  });

  // Enqueue a hard-delete sync operation.
  void enqueueQuietly(note.workspaceId, "delete", note.id, {
    id: note.id,
    permanent: true,
    remoteId: remoteMapping?.remoteId ?? null,
  });

  // Clean up the remote mapping (if it existed).
  if (remoteMapping) {
    await deleteRemoteMapping(note.workspaceId, "note", note.id);
  }
}

// ─── Pin / Unpin ──────────────────────────────────────────────────────────────

/**
 * Toggles the isPinned field on a note.
 */
export async function toggleNotePin(note: LocalNote): Promise<LocalNote> {
  const updated: LocalNote = {
    ...note,
    isPinned: !note.isPinned,
    updatedAt: new Date().toISOString(),
  };
  await putLocalNote(updated);
  void enqueueQuietly(note.workspaceId, "update", note.id, { id: note.id, isPinned: updated.isPinned });
  return updated;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Converts a LocalNote to a plain sync payload object.
 * The payload stored in the queue is deliberately simple (no nested objects
 * with circular references) so it can be directly serialized to JSON for the
 * MongoDB adapter.
 */
function noteToPayload(note: LocalNote): Record<string, unknown> {
  return {
    id: note.id,
    workspaceId: note.workspaceId,
    title: note.title,
    body: note.body,
    isPinned: note.isPinned,
    isFavorited: note.isFavorited,
    tags: note.tags,
    files: note.files,
    deletedAt: note.deletedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
