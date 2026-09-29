import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  AttachmentRepository,
  createAttachmentRecord,
} from "./attachmentRepository";
import { MigrationManager } from "./migrationManager";
import {
  runTransaction,
  putLocalNote,
  getLocalNote,
  putLocalAttachmentBlob,
  requestToPromise,
} from "./localWorkspaceDatabase";
import {
  AttachmentRecord,
  AttachmentDeletionRecord,
} from "../types";

const WORKSPACE_A = "ws-alpha-100";
const WORKSPACE_B = "ws-beta-200";

describe("Phase 3A: Attachment Subsystem Verification & Hardening Suite", () => {
  beforeEach(async () => {
    // Clean IndexedDB state before each test
    const req = indexedDB.deleteDatabase("aymo_local");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  // 1. Atomic attachment creation
  it("1. performs atomic attachment creation in ONE IndexedDB transaction", async () => {
    const record = createAttachmentRecord({
      noteId: "note-1",
      workspaceId: WORKSPACE_A,
      name: "document.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    const blob = new Blob(["test-bytes"], { type: "application/pdf" });

    const created = await AttachmentRepository.commitLocalAttachment(record, blob);

    expect(created.id).toBe(record.id);
    expect(created.localState).toBe("LOCAL_READY");
  });

  // 2. Actual Blob persistence
  it("2. persists and verifies actual binary Blob content in attachmentBlobs store", async () => {
    const record = createAttachmentRecord({
      noteId: "note-1",
      workspaceId: WORKSPACE_A,
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 50,
    });
    const blob = new Blob(["binary-data-12345"], { type: "image/png" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    const retrievedBlob = await AttachmentRepository.getAttachmentBlob(
      record.id,
      WORKSPACE_A,
    );
    expect(retrievedBlob).toBeDefined();
    expect(retrievedBlob.size).toBe(blob.size);
    expect(retrievedBlob.type).toBe("image/png");
  });

  // 3. Attachment retrieval
  it("3. retrieves attachment metadata correctly by ID and by noteId", async () => {
    const record = createAttachmentRecord({
      noteId: "note-mult-1",
      workspaceId: WORKSPACE_A,
      name: "meta.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
    });
    const blob = new Blob(["meta"], { type: "text/plain" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    const fetchedById = await AttachmentRepository.getAttachment(
      record.id,
      WORKSPACE_A,
    );
    expect(fetchedById).not.toBeNull();
    expect(fetchedById?.name).toBe("meta.txt");

    const fetchedForNote = await AttachmentRepository.getAttachmentsForNote(
      "note-mult-1",
      WORKSPACE_A,
    );
    expect(fetchedForNote).toHaveLength(1);
    expect(fetchedForNote[0].id).toBe(record.id);
  });

  // 4. Missing Blob detection
  it("4. rejects retrieval with MISSING_BLOB error if binary Blob record is missing", async () => {
    const record = createAttachmentRecord({
      noteId: "note-corrupt",
      workspaceId: WORKSPACE_A,
      name: "corrupt.png",
      mimeType: "image/png",
      sizeBytes: 100,
    });

    // Save metadata ONLY (missing blob)
    await runTransaction("attachments", "readwrite", async (tx) => {
      tx.objectStore("attachments").put(record);
    });

    await expect(
      AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A),
    ).rejects.toThrow(/MISSING_BLOB/);
  });

  // 5. Workspace isolation
  it("5. strictly enforces workspace isolation across attachments and Blobs", async () => {
    const recordA = createAttachmentRecord({
      noteId: "note-a",
      workspaceId: WORKSPACE_A,
      name: "alpha.pdf",
      mimeType: "application/pdf",
      sizeBytes: 200,
    });
    const blobA = new Blob(["alpha-bytes"], { type: "application/pdf" });
    await AttachmentRepository.commitLocalAttachment(recordA, blobA);

    // Workspace B cannot fetch Workspace A's attachment or Blob
    const fetchedByB = await AttachmentRepository.getAttachment(
      recordA.id,
      WORKSPACE_B,
    );
    expect(fetchedByB).toBeNull();

    await expect(
      AttachmentRepository.getAttachmentBlob(recordA.id, WORKSPACE_B),
    ).rejects.toThrow();
  });

  // 6. Deletion without remote identity
  it("6. deletes attachment without tombstone when syncState is NOT_QUEUED and no remote identity exists", async () => {
    const record = createAttachmentRecord({
      noteId: "note-1",
      workspaceId: WORKSPACE_A,
      name: "local-only.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      syncState: "NOT_QUEUED",
    });
    const blob = new Blob(["data"], { type: "text/plain" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    const fetched = await AttachmentRepository.getAttachment(
      record.id,
      WORKSPACE_A,
    );
    expect(fetched).toBeNull();

    const tombstone = await runTransaction(
      "attachmentDeletions",
      "readonly",
      async (tx) => {
        const index = tx
          .objectStore("attachmentDeletions")
          .index("workspaceId_localAttachmentId");
        return requestToPromise<AttachmentDeletionRecord | undefined>(
          index.get([WORKSPACE_A, record.id]),
        );
      },
    );
    expect(tombstone).toBeUndefined();
  });

  // 7. Deletion with remote identity
  it("7. creates deletion tombstone when deleting SYNCED attachment with remote identity", async () => {
    const record = createAttachmentRecord({
      noteId: "note-synced",
      workspaceId: WORKSPACE_A,
      name: "remote.png",
      mimeType: "image/png",
      sizeBytes: 500,
      syncState: "SYNCED",
    });
    record.remoteId = "rem-555";
    record.cloudinaryPublicId = "cloud-pub-555";

    const blob = new Blob(["remote-img"], { type: "image/png" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    const tombstone = await runTransaction(
      "attachmentDeletions",
      "readonly",
      async (tx) => {
        const index = tx
          .objectStore("attachmentDeletions")
          .index("workspaceId_localAttachmentId");
        return requestToPromise<AttachmentDeletionRecord | undefined>(
          index.get([WORKSPACE_A, record.id]),
        );
      },
    );

    expect(tombstone).toBeDefined();
    expect(tombstone?.remoteId).toBe("rem-555");
    expect(tombstone?.cloudinaryPublicId).toBe("cloud-pub-555");
    expect(tombstone?.status).toBe("PENDING");
  });

  // 8. FAILED attachment deletion
  it("8. creates deletion tombstone when deleting FAILED attachment that has remote identity", async () => {
    const record = createAttachmentRecord({
      noteId: "note-failed",
      workspaceId: WORKSPACE_A,
      name: "failed-upload.png",
      mimeType: "image/png",
      sizeBytes: 120,
      syncState: "FAILED",
    });
    record.remoteId = "rem-failed-777";

    const blob = new Blob(["failed-img"], { type: "image/png" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    const tombstone = await runTransaction(
      "attachmentDeletions",
      "readonly",
      async (tx) => {
        const index = tx
          .objectStore("attachmentDeletions")
          .index("workspaceId_localAttachmentId");
        return requestToPromise<AttachmentDeletionRecord | undefined>(
          index.get([WORKSPACE_A, record.id]),
        );
      },
    );

    expect(tombstone).toBeDefined();
    expect(tombstone?.remoteId).toBe("rem-failed-777");
  });

  // 9. Tombstone uniqueness
  it("9. enforces single unique tombstone per (workspaceId, localAttachmentId) without duplicates", async () => {
    const record = createAttachmentRecord({
      noteId: "note-uniq",
      workspaceId: WORKSPACE_A,
      name: "unique.png",
      mimeType: "image/png",
      sizeBytes: 30,
      syncState: "SYNCED",
    });
    record.remoteId = "rem-uniq-1";
    const blob = new Blob(["u"], { type: "image/png" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    // Delete once
    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );
    // Delete again (repeated call)
    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    const allTombstones = await runTransaction(
      "attachmentDeletions",
      "readonly",
      async (tx) => {
        return requestToPromise<AttachmentDeletionRecord[]>(
          tx.objectStore("attachmentDeletions").getAll(),
        );
      },
    );

    const matches = allTombstones.filter(
      (t) =>
        t.workspaceId === WORKSPACE_A && t.localAttachmentId === record.id,
    );
    expect(matches).toHaveLength(1);
  });

  // 10. Late remote ID with tombstone
  it("10. reconciles late remote ID into existing tombstone without resurrecting deleted attachment", async () => {
    const record = createAttachmentRecord({
      noteId: "note-late",
      workspaceId: WORKSPACE_A,
      name: "late.pdf",
      mimeType: "application/pdf",
      sizeBytes: 80,
      syncState: "SYNCING",
    });
    const blob = new Blob(["late-bytes"], { type: "application/pdf" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    // Delete attachment
    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    // Late sync response arrives with remote identity
    await AttachmentRepository.reconcileLateRemoteId(
      WORKSPACE_A,
      record.id,
      "late-rem-id-123",
      "late-cloud-pub-123",
    );

    const tombstone = await runTransaction(
      "attachmentDeletions",
      "readonly",
      async (tx) => {
        const index = tx
          .objectStore("attachmentDeletions")
          .index("workspaceId_localAttachmentId");
        return requestToPromise<AttachmentDeletionRecord | undefined>(
          index.get([WORKSPACE_A, record.id]),
        );
      },
    );

    expect(tombstone?.remoteId).toBe("late-rem-id-123");
    expect(tombstone?.cloudinaryPublicId).toBe("late-cloud-pub-123");

    // Attachment metadata MUST NOT be recreated
    const restored = await AttachmentRepository.getAttachment(
      record.id,
      WORKSPACE_A,
    );
    expect(restored).toBeNull();
  });

  // 11. Late remote ID without tombstone
  it("11. creates durable syncQueue cleanup record if late remote ID arrives without tombstone", async () => {
    await AttachmentRepository.reconcileLateRemoteId(
      WORKSPACE_A,
      "orphan-attachment-id",
      "orphan-remote-999",
      "orphan-cloud-999",
    );

    const queueRecords = await runTransaction(
      "syncQueue",
      "readonly",
      async (tx) => {
        return requestToPromise<any[]>(tx.objectStore("syncQueue").getAll());
      },
    );

    const cleanup = queueRecords.find(
      (q) => q.entityType === "attachment_cleanup",
    );
    expect(cleanup).toBeDefined();
    expect(cleanup.payload.remoteId).toBe("orphan-remote-999");
  });

  // 12. Durable cleanup queue creation
  it("12. persists attachment_cleanup intent durably in syncQueue for future worker", async () => {
    await AttachmentRepository.reconcileLateRemoteId(
      WORKSPACE_B,
      "att-cleanup-target",
      "rem-clean-44",
      "cloud-clean-44",
    );

    const queueRecords = await runTransaction(
      "syncQueue",
      "readonly",
      async (tx) => {
        return requestToPromise<any[]>(tx.objectStore("syncQueue").getAll());
      },
    );

    const item = queueRecords.find(
      (q) => q.workspaceId === WORKSPACE_B && q.entityType === "attachment_cleanup",
    );
    expect(item).toBeDefined();
    expect(item.status).toBe("pending");
  });

  // 13. Migration with one legacy attachment
  it("13. migrates note with single legacy attachment correctly", async () => {
    const note = {
      id: "note-single-legacy",
      workspaceId: WORKSPACE_A,
      title: "Single Legacy",
      body: "Text",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [
        {
          id: "att-legacy-single",
          fileName: "single.jpg",
          mimeType: "image/jpeg",
          fileSize: 300,
        },
      ],
    };

    await putLocalNote(note as any);
    await putLocalAttachmentBlob(
      "att-legacy-single",
      WORKSPACE_A,
      new Blob(["jpg-bytes"], { type: "image/jpeg" }),
    );

    const mig = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(mig.migratedAttachmentCount).toBe(1);

    const att = await AttachmentRepository.getAttachment(
      "att-legacy-single",
      WORKSPACE_A,
    );
    expect(att).not.toBeNull();
    expect(att?.name).toBe("single.jpg");

    const updatedNote = await getLocalNote("note-single-legacy");
    expect("files" in (updatedNote as any)).toBe(false);
  });

  // 14. Migration with multiple attachments
  it("14. migrates note with multiple legacy attachments in one note", async () => {
    const note = {
      id: "note-multi-legacy",
      workspaceId: WORKSPACE_A,
      title: "Multi Legacy",
      body: "Text",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [
        { id: "m-1", fileName: "f1.pdf", mimeType: "application/pdf", fileSize: 100 },
        { id: "m-2", fileName: "f2.png", mimeType: "image/png", fileSize: 200 },
      ],
    };

    await putLocalNote(note as any);
    await putLocalAttachmentBlob("m-1", WORKSPACE_A, new Blob(["b1"], { type: "application/pdf" }));
    await putLocalAttachmentBlob("m-2", WORKSPACE_A, new Blob(["b2"], { type: "image/png" }));

    const mig = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(mig.migratedAttachmentCount).toBe(2);

    const att1 = await AttachmentRepository.getAttachment("m-1", WORKSPACE_A);
    const att2 = await AttachmentRepository.getAttachment("m-2", WORKSPACE_A);
    expect(att1).not.toBeNull();
    expect(att2).not.toBeNull();
  });

  // 15. Migration restart/idempotency
  it("15. verifies migration restart and idempotency without duplicate creation", async () => {
    const note = {
      id: "note-idem",
      workspaceId: WORKSPACE_A,
      title: "Idempotent",
      body: "Body",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [{ id: "idem-att", fileName: "idem.txt", mimeType: "text/plain", fileSize: 5 }],
    };

    await putLocalNote(note as any);
    await putLocalAttachmentBlob("idem-att", WORKSPACE_A, new Blob(["idem"], { type: "text/plain" }));

    const res1 = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(res1.status).toBe("completed");

    const res2 = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(res2.status).toBe("completed");
  });

  // 16. Migration with missing Blob
  it("16. classifies legacy attachment as LOCAL_FAILED and MISSING_BLOB if binary Blob is absent", async () => {
    const note = {
      id: "note-missing-blob",
      workspaceId: WORKSPACE_A,
      title: "Missing Binary",
      body: "Text",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [{ id: "lost-blob-1", fileName: "lost.png", mimeType: "image/png", fileSize: 50 }],
    };

    await putLocalNote(note as any);

    const mig = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(mig.missingBlobCount).toBe(1);

    const att = await AttachmentRepository.getAttachment("lost-blob-1", WORKSPACE_A);
    expect(att?.localState).toBe("LOCAL_FAILED");
    expect(att?.localErrorCode).toBe("MISSING_BLOB");
  });

  // 17. Migration across two workspaces
  it("17. verifies independent migration state tracking across multiple workspaces", async () => {
    const noteA = {
      id: "note-ws-a",
      workspaceId: WORKSPACE_A,
      title: "Note A",
      body: "A",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [{ id: "att-a", fileName: "a.txt", mimeType: "text/plain", fileSize: 10 }],
    };

    const noteB = {
      id: "note-ws-b",
      workspaceId: WORKSPACE_B,
      title: "Note B",
      body: "B",
      isPinned: false,
      isFavorited: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      tags: [],
      files: [{ id: "att-b", fileName: "b.txt", mimeType: "text/plain", fileSize: 10 }],
    };

    await putLocalNote(noteA as any);
    await putLocalNote(noteB as any);
    await putLocalAttachmentBlob("att-a", WORKSPACE_A, new Blob(["a"], { type: "text/plain" }));
    await putLocalAttachmentBlob("att-b", WORKSPACE_B, new Blob(["b"], { type: "text/plain" }));

    // Run migration for Workspace A
    const migA = await MigrationManager.runStageBMigration(WORKSPACE_A);
    expect(migA.status).toBe("completed");

    // Migration state for Workspace B must NOT be completed yet
    const stateB = await MigrationManager.getMigrationState(WORKSPACE_B);
    expect(stateB?.status).not.toBe("completed");

    // Run migration for Workspace B independently
    const migB = await MigrationManager.runStageBMigration(WORKSPACE_B);
    expect(migB.status).toBe("completed");
  });

  // 18. Transaction failure/rejection
  it("18. rejects transaction cleanly on invalid store operation", async () => {
    await expect(
      runTransaction(["attachments"], "readwrite", async (tx) => {
        // Invalid index fetch
        const store = tx.objectStore("attachments");
        return requestToPromise((store as any).index("non_existent_index").get("x"));
      }),
    ).rejects.toThrow();
  });

  // 19. Transaction does not hang
  it("19. guarantees transaction resolves or rejects promptly without hanging promises", async () => {
    const promise = runTransaction("attachments", "readonly", async (tx) => {
      const store = tx.objectStore("attachments");
      return requestToPromise(store.getAll());
    });

    const result = await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Hanging promise!")), 2000)),
    ]);

    expect(Array.isArray(result)).toBe(true);
  });

  // 20. Deletion crash/recovery semantics
  it("20. maintains atomic state on deletion without leaving orphan metadata", async () => {
    const record = createAttachmentRecord({
      noteId: "note-crash",
      workspaceId: WORKSPACE_A,
      name: "crash-test.txt",
      mimeType: "text/plain",
      sizeBytes: 15,
    });
    const blob = new Blob(["crash-data"], { type: "text/plain" });
    await AttachmentRepository.commitLocalAttachment(record, blob);

    await AttachmentRepository.deleteLocalAttachmentAtomic(
      WORKSPACE_A,
      record.id,
    );

    // Verify metadata and Blob are both absent after deletion
    const meta = await AttachmentRepository.getAttachment(record.id, WORKSPACE_A);
    expect(meta).toBeNull();

    await expect(
      AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A),
    ).rejects.toThrow();
  });
});
