/**
 * localAttachmentService.ts
 *
 * Backward-compatibility wrapper delegating to AttachmentService and AttachmentRepository.
 */

import { AttachmentService } from "./attachmentService";
import { AttachmentRepository, detectAttachmentKind as detectKind } from "./attachmentRepository";
import { getActiveWorkspaceId } from "./localWorkspaceDatabase";
import { AttachmentKind } from "../types";

export type LocalAttachmentKind = AttachmentKind;

export interface LocalAttachmentMeta {
  id: string;
  workspaceId: string;
  noteId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: LocalAttachmentKind;
  sizeLabel: string;
  createdAt: string;
  syncStatus: "local" | "syncing" | "synced" | "failed";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function detectAttachmentKind(file: File): LocalAttachmentKind {
  return detectKind(file.name, file.type);
}

export async function saveLocalAttachment(
  file: File,
  noteId: string,
  workspaceId: string,
): Promise<LocalAttachmentMeta> {
  const record = await AttachmentService.createAttachment(file, noteId, workspaceId);
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    noteId: record.noteId,
    fileName: record.name,
    mimeType: record.mimeType,
    fileSize: record.sizeBytes,
    kind: record.kind,
    sizeLabel: formatBytes(record.sizeBytes),
    createdAt: record.createdAt,
    syncStatus: "local",
  };
}

export async function getLocalAttachmentBlobById(
  id: string,
  workspaceId?: string,
): Promise<Blob | null> {
  const activeWs = workspaceId || (await getActiveWorkspaceId()) || "";
  try {
    return await AttachmentRepository.getAttachmentBlob(id, activeWs);
  } catch {
    return null;
  }
}

export async function deleteLocalAttachmentById(
  id: string,
  workspaceId?: string,
): Promise<void> {
  const activeWs = workspaceId || (await getActiveWorkspaceId()) || "";
  if (!activeWs) return;
  await AttachmentService.deleteAttachment(id, activeWs);
}
