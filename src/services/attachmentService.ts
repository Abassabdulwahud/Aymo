import { AttachmentRecord, UploadedItem } from "../types";
import {
  AttachmentRepository,
  createAttachmentRecord,
} from "./attachmentRepository";
import {
  getActiveWorkspaceId,
  runTransaction,
  requestToPromise,
  generateUuid,
} from "./localWorkspaceDatabase";

// ─── Formatters & Mappers ─────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatRelativeTime(timestamp: string): string {
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return "Just now";
  const diffMinutes = Math.max(0, Math.round((Date.now() - value) / 60000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

export function mapAttachmentRecordToUploadedItem(
  record: AttachmentRecord,
): UploadedItem {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    sizeLabel: record.kind === "link" ? "Link" : formatBytes(record.sizeBytes),
    source: record.remoteUrl,
    addedAt: formatRelativeTime(record.createdAt),
    extractionStatus: record.localState === "LOCAL_READY" ? "completed" : "failed",
    extractionError: record.localError ?? null,
  };
}

// ─── Event Notification ───────────────────────────────────────────────────────

export type AttachmentEvent = {
  action: "created" | "deleted" | "updated";
  workspaceId: string;
  noteId?: string;
  attachmentId?: string;
};

const listeners = new Set<(event: AttachmentEvent) => void>();

const DEV = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;

export function subscribeAttachmentChanges(
  listener: (event: AttachmentEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAttachmentListeners(event: AttachmentEvent): void {
  if (DEV) {
    console.debug(
      `[AYMO-ATT] event action=${event.action} workspaceId=${event.workspaceId} noteId=${event.noteId ?? "—"} attachmentId=${event.attachmentId ?? "—"}`,
    );
  }
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      console.error("[AttachmentService] Listener error:", err);
    }
  });
}

// ─── AttachmentService Public API ─────────────────────────────────────────────

export class AttachmentService {
  /**
   * Lists all local attachments for a note in a workspace directly from IndexedDB.
   */
  static async listAttachments(
    noteId: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord[]> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    if (!wsId || !noteId) return [];
    const records = await AttachmentRepository.getAttachmentsForNote(noteId, wsId);
    if (DEV) {
      console.debug(
        `[AYMO-ATT] listAttachments noteId=${noteId} workspaceId=${wsId} → ${records.length} record(s): [${records.map((r) => r.id).join(", ")}]`,
      );
    }
    return records;
  }

  /**
   * Retrieves an AttachmentRecord by ID.
   */
  static async getAttachment(
    attachmentId: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord | null> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    return AttachmentRepository.getAttachment(attachmentId, wsId);
  }

  /**
   * Retrieves the raw binary Blob for a local attachment.
   */
  static async getAttachmentBlob(
    attachmentId: string,
    workspaceId?: string,
  ): Promise<Blob> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    return AttachmentRepository.getAttachmentBlob(attachmentId, wsId);
  }

  /**
   * Creates and commits a local attachment (file + metadata) in ONE IndexedDB transaction.
   * Works offline, unauthenticated, authenticated, online.
   */
  static async createAttachment(
    file: File,
    noteId: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    if (!wsId) {
      throw new Error("Active workspaceId is required to create an attachment.");
    }
    if (!noteId) {
      throw new Error("noteId is required to create an attachment.");
    }

    if (DEV) {
      console.debug(
        `[AYMO-ATT] createAttachment START name=${file.name} mimeType=${file.type} sizeBytes=${file.size} noteId=${noteId} workspaceId=${wsId}`,
      );
    }

    const record = createAttachmentRecord({
      noteId,
      workspaceId: wsId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });

    const committed = await AttachmentRepository.commitLocalAttachment(record, file);

    if (DEV) {
      console.debug(
        `[AYMO-ATT] createAttachment DONE id=${committed.id} localState=${committed.localState} syncState=${committed.syncState}`,
      );
    }

    notifyAttachmentListeners({
      action: "created",
      workspaceId: wsId,
      noteId,
      attachmentId: committed.id,
    });

    return committed;
  }

  /**
   * Creates a link attachment.
   */
  static async createLinkAttachment(
    url: string,
    name: string,
    noteId: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    const id = generateUuid();
    const now = new Date().toISOString();

    const record: AttachmentRecord = {
      id,
      noteId,
      workspaceId: wsId,
      name: name || url,
      mimeType: "text/x-uri",
      sizeBytes: 0,
      kind: "link",
      extension: "",
      localState: "LOCAL_READY",
      localError: null,
      localErrorCode: null,
      syncState: "NOT_QUEUED",
      retryCount: 0,
      nextRetryAt: null,
      lastSyncError: null,
      syncErrorCode: null,
      errorCategory: null,
      createdAt: now,
      updatedAt: now,
      remoteUrl: url,
      blobDiagnosticStatus: "blob_verified",
    };

    await runTransaction("attachments", "readwrite", async (tx) => {
      tx.objectStore("attachments").put(record);
    });

    notifyAttachmentListeners({
      action: "created",
      workspaceId: wsId,
      noteId,
      attachmentId: id,
    });

    return record;
  }

  /**
   * Deletes a local attachment atomically from IndexedDB (metadata + Blob + tombstone).
   */
  static async deleteAttachment(
    attachmentId: string,
    workspaceId?: string,
  ): Promise<void> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    if (!wsId) return;

    if (DEV) {
      console.debug(
        `[AYMO-ATT] deleteAttachment id=${attachmentId} workspaceId=${wsId}`,
      );
    }

    await AttachmentRepository.deleteLocalAttachmentAtomic(wsId, attachmentId);

    if (DEV) {
      console.debug(`[AYMO-ATT] deleteAttachment DONE id=${attachmentId}`);
    }

    notifyAttachmentListeners({
      action: "deleted",
      workspaceId: wsId,
      attachmentId,
    });
  }

  /**
   * Renames a local attachment.
   */
  static async renameAttachment(
    attachmentId: string,
    name: string,
    workspaceId?: string,
  ): Promise<AttachmentRecord> {
    const wsId = workspaceId || (await getActiveWorkspaceId()) || "";
    const updated = await AttachmentRepository.updateAttachment(
      attachmentId,
      wsId,
      { name },
    );

    notifyAttachmentListeners({
      action: "updated",
      workspaceId: wsId,
      noteId: updated.noteId,
      attachmentId,
    });

    return updated;
  }
}
