import {
  AttachmentRecord,
  AttachmentBlobRecord,
  AttachmentDeletionRecord,
  AttachmentKind,
} from "../types";
import {
  runTransaction,
  requestToPromise,
  generateUuid,
} from "./localWorkspaceDatabase";

const DEV = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function detectAttachmentKind(fileName: string, mimeType: string): AttachmentKind {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) {
    return "image";
  }
  if (ext === "pdf" || mime === "application/pdf") {
    return "pdf";
  }
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext)) {
    return "video";
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) {
    return "audio";
  }
  return "document";
}

export function createAttachmentRecord(params: {
  noteId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  id?: string;
  syncState?: AttachmentRecord["syncState"];
}): AttachmentRecord {
  const id = params.id ?? generateUuid();
  const now = new Date().toISOString();
  const extension = params.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = detectAttachmentKind(params.name, params.mimeType);

  return {
    id,
    noteId: params.noteId,
    workspaceId: params.workspaceId,
    name: params.name,
    mimeType: params.mimeType || "application/octet-stream",
    sizeBytes: params.sizeBytes,
    kind,
    extension,
    localState: "LOCAL_READY",
    localError: null,
    localErrorCode: null,
    syncState: params.syncState ?? "NOT_QUEUED",
    retryCount: 0,
    nextRetryAt: null,
    lastSyncError: null,
    syncErrorCode: null,
    errorCategory: null,
    createdAt: now,
    updatedAt: now,
    blobDiagnosticStatus: "blob_verified",
  };
}

// ─── AttachmentRepository ──────────────────────────────────────────────────────

export class AttachmentRepository {
  /**
   * Safe local attachment creation.
   * Persists AttachmentRecord and AttachmentBlobRecord in ONE IndexedDB transaction.
   */
  static async commitLocalAttachment(
    record: AttachmentRecord,
    blob: Blob,
  ): Promise<AttachmentRecord> {
    if (DEV) {
      console.debug(
        `[AYMO-REPO] commitLocalAttachment id=${record.id} noteId=${record.noteId} workspaceId=${record.workspaceId} name="${record.name}" sizeBytes=${record.sizeBytes} blobSize=${blob.size}`,
      );
    }

    const blobRecord: AttachmentBlobRecord = {
      id: record.id,
      workspaceId: record.workspaceId,
      blob,
      mimeType: record.mimeType,
      updatedAt: record.updatedAt,
    };

    await runTransaction(
      ["attachments", "attachmentBlobs"],
      "readwrite",
      async (tx) => {
        const attStore = tx.objectStore("attachments");
        const blobStore = tx.objectStore("attachmentBlobs");

        attStore.put(record);
        blobStore.put(blobRecord);
      },
    );

    if (DEV) {
      console.debug(`[AYMO-REPO] commitLocalAttachment TX COMPLETE id=${record.id}`);
    }

    return record;
  }

  /**
   * Retrieves AttachmentRecord by ID and verifies workspace matching.
   */
  static async getAttachment(
    id: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord | null> {
    return runTransaction("attachments", "readonly", async (tx) => {
      const store = tx.objectStore("attachments");
      const record = await requestToPromise<AttachmentRecord | undefined>(
        store.get(id),
      );
      if (!record) return null;
      if (workspaceId && record.workspaceId !== workspaceId) return null;
      return record;
    });
  }

  /**
   * Retrieves all AttachmentRecords for a note within a workspace.
   */
  static async getAttachmentsForNote(
    noteId: string,
    workspaceId: string,
  ): Promise<AttachmentRecord[]> {
    return runTransaction("attachments", "readonly", async (tx) => {
      const store = tx.objectStore("attachments");
      let records: AttachmentRecord[] = [];
      if (store.indexNames.contains("noteId")) {
        const index = store.index("noteId");
        records = await requestToPromise<AttachmentRecord[]>(
          index.getAll(noteId),
        );
      } else {
        const index = store.index("workspaceId");
        const all = await requestToPromise<AttachmentRecord[]>(
          index.getAll(workspaceId),
        );
        records = all.filter((r) => r.noteId === noteId);
      }

      const filtered = records.filter((r) => r.workspaceId === workspaceId);
      if (DEV) {
        console.debug(
          `[AYMO-REPO] getAttachmentsForNote noteId=${noteId} workspaceId=${workspaceId} → ${filtered.length} record(s)`,
        );
      }
      return filtered;
    });
  }

  /**
   * Safe local attachment retrieval.
   * Reads metadata, verifies workspace isolation, and returns actual Blob binary.
   */
  static async getAttachmentBlob(
    id: string,
    workspaceId: string,
  ): Promise<Blob> {
    return runTransaction(
      ["attachments", "attachmentBlobs"],
      "readonly",
      async (tx) => {
        const attStore = tx.objectStore("attachments");
        const blobStore = tx.objectStore("attachmentBlobs");

        const att = await requestToPromise<AttachmentRecord | undefined>(
          attStore.get(id),
        );
        if (!att || att.workspaceId !== workspaceId) {
          throw new Error(
            `Attachment metadata not found or workspace mismatch for id: ${id}`,
          );
        }

        const blobRec = await requestToPromise<
          AttachmentBlobRecord | undefined
        >(blobStore.get(id));
        if (!blobRec || !blobRec.blob) {
          throw new Error(
            `MISSING_BLOB: Binary blob missing for attachment id: ${id}`,
          );
        }

        if (DEV) {
          console.debug(
            `[AYMO-REPO] getAttachmentBlob id=${id} workspaceId=${workspaceId} blobSize=${blobRec.blob.size} mimeType=${blobRec.mimeType}`,
          );
        }

        return blobRec.blob;
      },
    );
  }

  /**
   * Safe local deletion.
   * Atomically deletes AttachmentRecord, AttachmentBlobRecord, and creates/updates
   * deletion tombstone if remote cleanup may be required.
   */
  static async deleteLocalAttachmentAtomic(
    workspaceId: string,
    attachmentId: string,
  ): Promise<void> {
    if (DEV) {
      console.debug(
        `[AYMO-REPO] deleteLocalAttachmentAtomic id=${attachmentId} workspaceId=${workspaceId}`,
      );
    }

    await runTransaction(
      ["attachments", "attachmentBlobs", "attachmentDeletions"],
      "readwrite",
      async (tx) => {
        const attStore = tx.objectStore("attachments");
        const blobStore = tx.objectStore("attachmentBlobs");
        const delStore = tx.objectStore("attachmentDeletions");

        const att = await requestToPromise<AttachmentRecord | undefined>(
          attStore.get(attachmentId),
        );
        if (att && att.workspaceId !== workspaceId) {
          throw new Error("Workspace isolation violation on attachment delete.");
        }

        // 1. Delete metadata
        attStore.delete(attachmentId);

        // 2. Delete Blob
        blobStore.delete(attachmentId);

        // 3. Determine if tombstone is required
        const requiresTombstone =
          !!att &&
          (att.syncState === "SYNCED" ||
            att.syncState === "SYNCING" ||
            att.syncState === "PENDING" ||
            !!att.remoteId ||
            !!att.cloudinaryPublicId ||
            !!att.remoteUrl ||
            (att.syncState === "FAILED" &&
              (!!att.remoteId || !!att.cloudinaryPublicId || !!att.remoteUrl)));

        if (DEV) {
          console.debug(
            `[AYMO-REPO] deleteLocalAttachmentAtomic tombstone=${requiresTombstone} syncState=${att?.syncState ?? "unknown"}`,
          );
        }

        if (requiresTombstone) {
          const index = delStore.index("workspaceId_localAttachmentId");
          const existingTombstone = await requestToPromise<
            AttachmentDeletionRecord | undefined
          >(index.get([workspaceId, attachmentId]));

          const now = new Date().toISOString();
          if (existingTombstone) {
            existingTombstone.status = "PENDING";
            existingTombstone.deletedAt = now;
            if (att.remoteId) existingTombstone.remoteId = att.remoteId;
            if (att.cloudinaryPublicId) {
              existingTombstone.cloudinaryPublicId = att.cloudinaryPublicId;
            }
            delStore.put(existingTombstone);
          } else {
            const tombstone: AttachmentDeletionRecord = {
              id: generateUuid(),
              workspaceId,
              localAttachmentId: attachmentId,
              remoteId: att.remoteId,
              cloudinaryPublicId: att.cloudinaryPublicId,
              deletedAt: now,
              status: "PENDING",
              retryCount: 0,
            };
            delStore.put(tombstone);
          }
        }
      },
    );

    if (DEV) {
      console.debug(`[AYMO-REPO] deleteLocalAttachmentAtomic TX COMPLETE id=${attachmentId}`);
    }
  }

  /**
   * Reconciles late remote IDs returned after local deletion.
   * If tombstone exists: attaches remote identity to tombstone.
   * If no tombstone exists: commits durable syncQueue cleanup record.
   */
  static async reconcileLateRemoteId(
    workspaceId: string,
    localAttachmentId: string,
    remoteId?: string,
    cloudinaryPublicId?: string,
  ): Promise<void> {
    await runTransaction(
      ["attachmentDeletions", "syncQueue"],
      "readwrite",
      async (tx) => {
        const delStore = tx.objectStore("attachmentDeletions");
        const sqStore = tx.objectStore("syncQueue");

        const index = delStore.index("workspaceId_localAttachmentId");
        const tombstone = await requestToPromise<
          AttachmentDeletionRecord | undefined
        >(index.get([workspaceId, localAttachmentId]));

        if (tombstone) {
          if (remoteId) tombstone.remoteId = remoteId;
          if (cloudinaryPublicId) tombstone.cloudinaryPublicId = cloudinaryPublicId;
          tombstone.status = "PENDING";
          delStore.put(tombstone);
        } else {
          // No tombstone exists -> create durable syncQueue cleanup record
          const now = new Date().toISOString();
          const queueItem = {
            id: generateUuid(),
            workspaceId,
            entityType: "attachment_cleanup",
            operation: "delete",
            payload: {
              localAttachmentId,
              remoteId,
              cloudinaryPublicId,
            },
            status: "pending",
            createdAt: now,
            retryCount: 0,
          };
          sqStore.put(queueItem);
        }
      },
    );
  }

  /**
   * Safe local rename / metadata update.
   */
  static async updateAttachment(
    id: string,
    workspaceId: string,
    patch: Partial<AttachmentRecord>,
  ): Promise<AttachmentRecord> {
    return runTransaction("attachments", "readwrite", async (tx) => {
      const store = tx.objectStore("attachments");
      const existing = await requestToPromise<AttachmentRecord | undefined>(
        store.get(id),
      );
      if (!existing || existing.workspaceId !== workspaceId) {
        throw new Error(
          `Attachment not found or workspace mismatch for id: ${id}`,
        );
      }

      const updated: AttachmentRecord = {
        ...existing,
        ...patch,
        id: existing.id, // ID must never change
        workspaceId: existing.workspaceId,
        noteId: patch.noteId ?? existing.noteId,
        updatedAt: new Date().toISOString(),
      };

      store.put(updated);
      return updated;
    });
  }
}
