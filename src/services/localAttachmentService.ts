/**
 * localAttachmentService.ts
 *
 * The single source of truth for all local (offline) attachment I/O.
 *
 * Responsibilities:
 *   - Store a raw File/Blob binary in IndexedDB (attachmentBlobs store).
 *   - Return rich metadata for callers that need to update note.files[].
 *   - Provide a blob-URL factory used by the viewer layer.
 *   - Clean up blobs on deletion.
 *
 * Object URLs created here are temporary browser references.
 * They are NOT stored anywhere — the viewer creates them on demand and
 * revokes them when done (see useLocalAttachmentUrl hook).
 */

import {
  putLocalAttachmentBlob,
  getLocalAttachmentBlob,
  deleteLocalAttachmentBlob,
  generateUuid,
} from "./localWorkspaceDatabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LocalAttachmentKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "document"
  | "link";

/**
 * Serialisable metadata stored in note.files[].
 * Does NOT contain the Blob or any Object URL — those are volatile.
 */
export interface LocalAttachmentMeta {
  /** UUID — matches the key in the attachmentBlobs IndexedDB store. */
  id: string;
  workspaceId: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: LocalAttachmentKind;
  /** Display-friendly file size (e.g. "6.2 MB") */
  sizeLabel: string;
  createdAt: string;
  /** "local" = stored only in IndexedDB; "synced" = also in cloud */
  syncStatus: "local" | "syncing" | "synced" | "failed";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable byte size (KB / MB / GB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Detect a human-friendly kind from the file extension / MIME type. */
export function detectAttachmentKind(file: File): LocalAttachmentKind {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  return "document";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a File to IndexedDB (attachmentBlobs store) and returns its metadata.
 *
 * This is the ONLY function that should be called when a user attaches a file
 * in offline/local mode. The binary is written BEFORE this function returns,
 * so the viewer can immediately load it via getLocalAttachmentBlob().
 */
export async function saveLocalAttachment(
  file: File,
  noteId: string,
  workspaceId: string,
): Promise<LocalAttachmentMeta> {
  const id = generateUuid();
  const now = new Date().toISOString();
  const kind = detectAttachmentKind(file);

  // ── Write binary FIRST — this is the source of truth ──────────────────────
  await putLocalAttachmentBlob(id, workspaceId, file);

  const meta: LocalAttachmentMeta = {
    id,
    workspaceId,
    noteId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    kind,
    sizeLabel: formatBytes(file.size),
    createdAt: now,
    syncStatus: "local",
  };

  return meta;
}

/**
 * Retrieves the raw Blob for a local attachment.
 * Returns null if the blob does not exist in IndexedDB.
 */
export async function getLocalAttachmentBlobById(id: string): Promise<Blob | null> {
  return getLocalAttachmentBlob(id);
}

/**
 * Permanently removes a local attachment blob from IndexedDB.
 * Safe to call even if the blob doesn't exist (no-op).
 */
export async function deleteLocalAttachmentById(id: string): Promise<void> {
  try {
    await deleteLocalAttachmentBlob(id);
  } catch (err) {
    console.warn("[localAttachmentService] deleteLocalAttachmentById: ignoring error", err);
  }
}
