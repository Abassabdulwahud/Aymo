import { MigrationStateRecord, AttachmentRecord } from "../types";
import {
  runTransaction,
  requestToPromise,
  generateUuid,
  LocalNote,
} from "./localWorkspaceDatabase";
import { createAttachmentRecord } from "./attachmentRepository";

export const MIGRATION_STATE_KEY_PREFIX = "v3_v4_migration";

export function getMigrationStateKey(workspaceId?: string): string {
  return workspaceId ? `${MIGRATION_STATE_KEY_PREFIX}_${workspaceId}` : MIGRATION_STATE_KEY_PREFIX;
}

export class MigrationManager {
  /**
   * Retrieves current migration state from IndexedDB for a given workspace.
   */
  static async getMigrationState(workspaceId?: string): Promise<MigrationStateRecord | null> {
    const key = getMigrationStateKey(workspaceId);
    return runTransaction("migrationState", "readonly", async (tx) => {
      const store = tx.objectStore("migrationState");
      const record = await requestToPromise<MigrationStateRecord | undefined>(
        store.get(key),
      );
      return record ?? null;
    });
  }

  /**
   * Executes Stage B migration from v3 (note.files[]) to v4 (attachments store).
   * Safe to run multiple times, idempotent, and restart-safe per workspace.
   */
  static async runStageBMigration(workspaceId: string): Promise<MigrationStateRecord> {
    const key = getMigrationStateKey(workspaceId);

    // 1. Check existing state for this workspace
    const existingState = await this.getMigrationState(workspaceId);
    if (existingState && existingState.status === "completed") {
      return existingState;
    }

    const now = new Date().toISOString();
    const stateRecord: MigrationStateRecord = existingState ?? {
      key,
      version: 4,
      status: "in_progress",
      migratedNoteCount: 0,
      totalNotesCount: 0,
      migratedAttachmentCount: 0,
      missingBlobCount: 0,
      lastProcessedNoteId: null,
      startedAt: now,
      completedAt: null,
      error: null,
    };

    stateRecord.status = "in_progress";
    await runTransaction("migrationState", "readwrite", async (tx) => {
      tx.objectStore("migrationState").put(stateRecord);
    });

    try {
      // 2. Fetch all notes for workspace
      const allNotes = await runTransaction("notes", "readonly", async (tx) => {
        const store = tx.objectStore("notes");
        if (store.indexNames.contains("workspaceId")) {
          const index = store.index("workspaceId");
          return requestToPromise<LocalNote[]>(index.getAll(workspaceId));
        }
        return requestToPromise<LocalNote[]>(store.getAll());
      });

      stateRecord.totalNotesCount = allNotes.length;

      // 3. Process notes idempotently
      for (const note of allNotes) {
        const legacyFiles = (note as any).files;
        const hasLegacyFiles = Array.isArray(legacyFiles) && legacyFiles.length > 0;

        await runTransaction(
          ["notes", "attachments", "attachmentBlobs", "migrationState"],
          "readwrite",
          async (tx) => {
            const noteStore = tx.objectStore("notes");
            const attStore = tx.objectStore("attachments");
            const blobStore = tx.objectStore("attachmentBlobs");
            const migStore = tx.objectStore("migrationState");

            if (hasLegacyFiles) {
              for (const legacyFile of legacyFiles) {
                const fileId = legacyFile.id ? String(legacyFile.id) : generateUuid();

                // Check if AttachmentRecord already exists
                const existingAtt = await requestToPromise<
                  AttachmentRecord | undefined
                >(attStore.get(fileId));

                if (!existingAtt) {
                  // Check if Blob exists in attachmentBlobs store
                  const blobRec = await requestToPromise<any>(blobStore.get(fileId));
                  const blobExists = !!(blobRec && blobRec.blob);

                  const name = legacyFile.fileName || legacyFile.name || "Untitled File";
                  const mimeType = legacyFile.mimeType || "application/octet-stream";
                  const sizeBytes = legacyFile.fileSize || legacyFile.size || 0;

                  const attRecord: AttachmentRecord = createAttachmentRecord({
                    id: fileId,
                    noteId: note.id,
                    workspaceId: note.workspaceId || workspaceId,
                    name,
                    mimeType,
                    sizeBytes,
                    syncState: legacyFile.syncStatus === "synced" ? "SYNCED" : "NOT_QUEUED",
                  });

                  if (blobExists) {
                    attRecord.localState = "LOCAL_READY";
                    attRecord.blobDiagnosticStatus = "blob_verified";
                    stateRecord.migratedAttachmentCount++;
                  } else {
                    attRecord.localState = "LOCAL_FAILED";
                    attRecord.localErrorCode = "MISSING_BLOB";
                    attRecord.localError = "Binary blob not found during migration";
                    attRecord.blobDiagnosticStatus = "blob_missing";
                    stateRecord.missingBlobCount++;
                  }

                  attStore.put(attRecord);
                }
              }
            }

            // Strip legacy files array from note
            if ("files" in note) {
              delete (note as any).files;
              noteStore.put(note);
            }

            stateRecord.migratedNoteCount++;
            stateRecord.lastProcessedNoteId = note.id;
            migStore.put(stateRecord);
          },
        );
      }

      // 4. Mark completed
      stateRecord.status = "completed";
      stateRecord.completedAt = new Date().toISOString();
      await runTransaction("migrationState", "readwrite", async (tx) => {
        tx.objectStore("migrationState").put(stateRecord);
      });

      return stateRecord;
    } catch (err: any) {
      stateRecord.status = "failed";
      stateRecord.error = err?.message || String(err);
      await runTransaction("migrationState", "readwrite", async (tx) => {
        tx.objectStore("migrationState").put(stateRecord);
      });
      throw err;
    }
  }
}
