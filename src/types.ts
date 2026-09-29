export type UploadKind = "image" | "pdf" | "document" | "video" | "audio" | "link";

export type AIProvider = "gemini" | "openai" | "deepseek" | "anthropic" | "groq" | "cohere";

export interface UploadedItem {
  id: string | number;
  name: string;
  kind: UploadKind;
  sizeLabel: string;
  source?: string;
  addedAt: string;
  extractionStatus?: string;
  extractionError?: string | null;
  progressPercent?: number;
  detailedSteps?: string | null;
  durationSeconds?: number | null;
  processedChunks?: number;
  totalChunks?: number;
}

export interface InsightItem {
  id: string;
  title: string;
  detail: string;
  type: "key-takeaways" | "questions" | "summary" | "live-summary" | "chat";
}

/**
 * Represents a single message in the AI assistant conversation.
 *
 * status lifecycle:
 *   "thinking"  — bubble visible, AI has not yet returned the first token
 *   "streaming" — first delta arrived, content is growing
 *   "done"      — stream complete, action bar is visible
 *   "error"     — stream failed, error content shown
 *
 * Messages without a status (legacy / loaded from cache before this update)
 * are treated as "done" when content.length > 0.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "thinking" | "streaming" | "done" | "error";
}

// ─── Universal Annotation System ─────────────────────────────────────────────

export type AnnotationSourceType = "pdf" | "note" | "ai" | "web";

export type AnnotationType =
  | "highlight"
  | "underline"
  | "strikethrough"
  | "comment"
  | "bookmark";

/** Relative bounding box within a rendered page (values are in pixels relative
 *  to the top-left of the page container at the time of capture). */
export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string | number;
  user_id: string | number;
  source_type: AnnotationSourceType;
  source_id: string | number;
  page_number: number | null;
  selected_text: string;
  bounding_rects: BoundingRect[] | null;
  start_offset: number | null;
  end_offset: number | null;
  color: string;
  annotation_type: AnnotationType;
  comment: string | null;
  linked_note_id: string | number | null;
  created_at: string;
  updated_at: string;
}

// ─── Phase 3A Attachment Subsystem Types ─────────────────────────────────────

export type AttachmentKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "document"
  | "link";

export type DurableLocalState =
  | "LOCAL_READY"
  | "LOCAL_FAILED";

export type SyncState =
  | "NOT_QUEUED"
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "FAILED";

export type LocalErrorCode =
  | "MISSING_BLOB"
  | "CORRUPTED_BLOB"
  | "STORAGE_QUOTA_EXCEEDED"
  | "WRITE_ABORTED"
  | null;

export type SyncErrorCategory =
  | "temporary_network"
  | "permanent_auth"
  | "remote_quota"
  | "server_error"
  | null;

export interface AttachmentRecord {
  id: string;
  noteId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  extension: string;
  localState: DurableLocalState;
  localError?: string | null;
  localErrorCode?: LocalErrorCode;
  syncState: SyncState;
  retryCount: number;
  nextRetryAt: string | null;
  lastSyncError: string | null;
  syncErrorCode: string | null;
  errorCategory: SyncErrorCategory;
  createdAt: string;
  updatedAt: string;
  remoteId?: string;
  cloudinaryPublicId?: string;
  remoteUrl?: string;
  blobDiagnosticStatus?:
    | "blob_verified"
    | "blob_missing"
    | "unchecked";
}

export interface AttachmentBlobRecord {
  id: string;
  workspaceId: string;
  blob: Blob;
  mimeType: string;
  updatedAt: string;
}

export type RemoteDeletionState =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export interface AttachmentDeletionRecord {
  id: string;
  workspaceId: string;
  localAttachmentId: string;
  remoteId?: string;
  cloudinaryPublicId?: string;
  deletedAt: string;
  status: RemoteDeletionState;
  retryCount: number;
  lastError?: string | null;
}

export interface MigrationStateRecord {
  key: string;
  version: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  migratedNoteCount: number;
  totalNotesCount: number;
  migratedAttachmentCount: number;
  missingBlobCount: number;
  lastProcessedNoteId: string | null;
  startedAt: string;
  completedAt: string | null;
  error?: string | null;
}

