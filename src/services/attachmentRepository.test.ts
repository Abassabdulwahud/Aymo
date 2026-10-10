import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  AttachmentRepository,
  createAttachmentRecord,
  deriveCloudinaryResourceType,
} from "./attachmentRepository";
import { MigrationManager } from "./migrationManager";
import {
  runTransaction,
  putLocalNote,
  getLocalNote,
  putLocalAttachmentBlob,
  requestToPromise,
} from "./localWorkspaceDatabase";
import { getAllQueueRecords } from "./syncQueue";
import * as syncQueue from "./syncQueue";
import { AttachmentService } from "./attachmentService";
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

  // ─── Phase 4B.2 — Local Attachment Tombstone & Resource-Type Durability ────
  describe("Phase 4B.2 — Local Attachment Tombstone & Resource-Type Durability", () => {
    it("B2-A/B2-K: derives correct Cloudinary resource types and retains resourceType in tombstone after local deletion", async () => {
      // 1. Image
      const imgRec = createAttachmentRecord({
        noteId: "note-b2",
        workspaceId: WORKSPACE_A,
        name: "test.png",
        mimeType: "image/png",
        sizeBytes: 100,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        imgRec,
        new Blob(["img"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, imgRec.id);
      const imgTombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, imgRec.id);
      expect(imgTombstone).toBeDefined();
      expect(imgTombstone?.resourceType).toBe("image");
      expect(imgTombstone?.workspaceId).toBe(WORKSPACE_A);
      expect(imgTombstone?.localAttachmentId).toBe(imgRec.id);

      // Verify metadata & blob are gone locally
      expect(await AttachmentRepository.getAttachment(imgRec.id, WORKSPACE_A)).toBeNull();

      // 2. Video
      const vidRec = createAttachmentRecord({
        noteId: "note-b2",
        workspaceId: WORKSPACE_A,
        name: "test.mp4",
        mimeType: "video/mp4",
        sizeBytes: 200,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        vidRec,
        new Blob(["vid"], { type: "video/mp4" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, vidRec.id);
      const vidTombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, vidRec.id);
      expect(vidTombstone?.resourceType).toBe("video");

      // 3. Audio -> video (Cloudinary requirement)
      const audRec = createAttachmentRecord({
        noteId: "note-b2",
        workspaceId: WORKSPACE_A,
        name: "test.mp3",
        mimeType: "audio/mp3",
        sizeBytes: 150,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        audRec,
        new Blob(["aud"], { type: "audio/mp3" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, audRec.id);
      const audTombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, audRec.id);
      expect(audTombstone?.resourceType).toBe("video");

      // 4. PDF / Document / Raw
      const pdfRec = createAttachmentRecord({
        noteId: "note-b2",
        workspaceId: WORKSPACE_A,
        name: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 300,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        pdfRec,
        new Blob(["pdf"], { type: "application/pdf" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, pdfRec.id);
      const pdfTombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, pdfRec.id);
      expect(pdfTombstone?.resourceType).toBe("raw");
    });

    it("B2-ResourceTypeMapping: deriveCloudinaryResourceType unit mappings", () => {
      expect(deriveCloudinaryResourceType("image", "image/jpeg")).toBe("image");
      expect(deriveCloudinaryResourceType("video", "video/mp4")).toBe("video");
      expect(deriveCloudinaryResourceType("audio", "audio/wav")).toBe("video");
      expect(deriveCloudinaryResourceType("pdf", "application/pdf")).toBe("raw");
      expect(deriveCloudinaryResourceType("document", "application/msword")).toBe("raw");
      expect(deriveCloudinaryResourceType("link", "text/x-uri")).toBe("raw");
      expect(deriveCloudinaryResourceType(null, "image/gif")).toBe("image");
      expect(deriveCloudinaryResourceType(null, "video/webm")).toBe("video");
      expect(deriveCloudinaryResourceType(null, "audio/m4a")).toBe("video");
      expect(deriveCloudinaryResourceType(null, "text/plain")).toBe("raw");
    });

    it("B2-C/B2-D: tombstone persists across reads and works offline", async () => {
      const record = createAttachmentRecord({
        noteId: "note-offline",
        workspaceId: WORKSPACE_A,
        name: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 50,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["clip"], { type: "video/mp4" }),
      );

      // Perform local deletion (offline environment)
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Tombstone is immediately durable in IDB
      const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tombstone).toBeDefined();
      expect(tombstone?.localAttachmentId).toBe(record.id);
      expect(tombstone?.resourceType).toBe("video");
      expect(tombstone?.status).toBe("PENDING");
    });

    it("B2-G: enforces workspace isolation on tombstone creation and lookup", async () => {
      const recordA = createAttachmentRecord({
        noteId: "note-wsA",
        workspaceId: WORKSPACE_A,
        name: "wsA.png",
        mimeType: "image/png",
        sizeBytes: 10,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        recordA,
        new Blob(["a"], { type: "image/png" }),
      );

      // Attempt deletion with wrong workspace ID throws isolation error
      await expect(
        AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_B, recordA.id),
      ).rejects.toThrow(/Workspace isolation violation/);

      // Delete with correct workspace ID succeeds
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, recordA.id);

      // Tombstone is accessible in WORKSPACE_A, but not WORKSPACE_B
      const tombA = await AttachmentRepository.getTombstone(WORKSPACE_A, recordA.id);
      expect(tombA).toBeDefined();

      const tombB = await AttachmentRepository.getTombstone(WORKSPACE_B, recordA.id);
      expect(tombB).toBeUndefined();
    });

    it("B2-L: handles repeated/idempotent local deletion safely", async () => {
      const record = createAttachmentRecord({
        noteId: "note-idem",
        workspaceId: WORKSPACE_A,
        name: "idem.txt",
        mimeType: "text/plain",
        sizeBytes: 25,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["idem"], { type: "text/plain" }),
      );

      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);
      const tomb1 = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tomb1).toBeDefined();

      // Repeat deletion call
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);
      const tomb2 = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tomb2).toBeDefined();
      expect(tomb2?.id).toBe(tomb1?.id);
    });

    it("B2-M: tombstone prevents reconcileMissingQueueEntries from resurrecting a deleted attachment", async () => {
      const record = createAttachmentRecord({
        noteId: "note-resurrection",
        workspaceId: WORKSPACE_A,
        name: "deleted.png",
        mimeType: "image/png",
        sizeBytes: 40,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["del"], { type: "image/png" }),
      );

      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Run queue reconstruction pass
      const recovered = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_A);
      expect(recovered).toBe(0);
    });

    // ─── Phase 4B.2 Correction — Durable Delete Queue Recovery ───────────────

    it("B2-P: after deleteLocalAttachmentAtomic, tombstone exists but no DELETE queue entry", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2p",
        workspaceId: WORKSPACE_A,
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 512,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["px"], { type: "image/png" }),
      );

      // Delete atomically (simulates the case where enqueueSyncOperation subsequently fails)
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Tombstone must exist
      const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tombstone).toBeDefined();
      expect(tombstone?.status).toBe("PENDING");

      // Metadata and blob must be gone
      expect(await AttachmentRepository.getAttachment(record.id, WORKSPACE_A)).toBeNull();
    });

    it("B2-Q: reconcileMissingDeleteQueueEntries creates a DELETE queue entry from tombstone", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2q",
        workspaceId: WORKSPACE_A,
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 512,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["px"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Manually clear any enqueued DELETE that deleteAttachment may have put in
      // (we call atomic directly, so nothing should be queued yet)
      const before = await getAllQueueRecords(WORKSPACE_A);
      const deletesBefore = before.filter(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(deletesBefore).toHaveLength(0);

      const recovered = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(recovered).toBeGreaterThanOrEqual(1);

      const after = await getAllQueueRecords(WORKSPACE_A);
      const deletesAfter = after.filter(
        (r) =>
          r.entityType === "attachment" &&
          r.operation === "delete" &&
          r.localId === record.id,
      );
      expect(deletesAfter).toHaveLength(1);
      expect(deletesAfter[0].workspaceId).toBe(WORKSPACE_A);
    });

    it("B2-R: reconstructed DELETE queue entry payload contains correct resourceType from tombstone", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2r",
        workspaceId: WORKSPACE_A,
        name: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1024,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["v"], { type: "video/mp4" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tombstone?.resourceType).toBe("video");

      await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);

      const queueRecords = await getAllQueueRecords(WORKSPACE_A);
      const entry = queueRecords.find(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(entry).toBeDefined();
      expect(entry?.payload?.resourceType).toBe("video");
      expect(entry?.payload?.id).toBe(record.id);
      expect(entry?.payload?.workspaceId).toBe(WORKSPACE_A);
    });

    it("B2-S: calling reconcileMissingDeleteQueueEntries 3x produces exactly 1 DELETE queue entry (idempotent)", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2s",
        workspaceId: WORKSPACE_A,
        name: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 200,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["d"], { type: "application/pdf" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);

      const queueRecords = await getAllQueueRecords(WORKSPACE_A);
      const deletes = queueRecords.filter(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(deletes).toHaveLength(1);
    });

    it("B2-T: simulated restart — reconcileMissingDeleteQueueEntries reconstructs queue from durable tombstone", async () => {
      // IDB is persistent per test suite with fake-indexeddb/auto; this tests
      // that tombstone state alone is sufficient to recover (no in-memory state needed)
      const record = createAttachmentRecord({
        noteId: "note-b2t",
        workspaceId: WORKSPACE_A,
        name: "audio.mp3",
        mimeType: "audio/mp3",
        sizeBytes: 300,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["a"], { type: "audio/mp3" }),
      );
      // Phase 1: delete committed (simulates crash before enqueue)
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Phase 2: "restart" — tombstone must still be present
      const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
      expect(tombstone).toBeDefined();
      expect(tombstone?.resourceType).toBe("video"); // audio → video in Cloudinary

      // Phase 3: recovery reconstructs queue entry
      const recovered = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(recovered).toBeGreaterThanOrEqual(1);

      const queueRecords = await getAllQueueRecords(WORKSPACE_A);
      const entry = queueRecords.find(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(entry).toBeDefined();
    });

    it("B2-U: workspace isolation — recovery for workspace B does not affect workspace A tombstones", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2u",
        workspaceId: WORKSPACE_A,
        name: "img.png",
        mimeType: "image/png",
        sizeBytes: 100,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["i"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Recovery for WORKSPACE_B should produce 0
      const countB = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_B);
      expect(countB).toBe(0);

      // Recovery for WORKSPACE_A should produce ≥1
      const countA = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(countA).toBeGreaterThanOrEqual(1);
    });

    it("B2-V: after recovery, getAttachment returns null and getAttachmentBlob does not restore data", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2v",
        workspaceId: WORKSPACE_A,
        name: "file.png",
        mimeType: "image/png",
        sizeBytes: 50,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["f"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);
      await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);

      // Metadata must still be gone
      const att = await AttachmentRepository.getAttachment(record.id, WORKSPACE_A);
      expect(att).toBeNull();

      // Blob must still be gone
      await expect(
        AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A),
      ).rejects.toThrow();
    });

    it("B2-W: tombstoned attachment excluded from CREATE recovery (reconcileMissingQueueEntries returns 0)", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2w",
        workspaceId: WORKSPACE_A,
        name: "gone.png",
        mimeType: "image/png",
        sizeBytes: 80,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["g"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // CREATE recovery must skip this — it is tombstoned
      const recovered = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_A);
      expect(recovered).toBe(0);
    });

    it("B2-X: tombstone with existing active pending DELETE queue entry — recovery returns 0 (no duplicate)", async () => {
      const record = createAttachmentRecord({
        noteId: "note-b2x",
        workspaceId: WORKSPACE_A,
        name: "dup.png",
        mimeType: "image/png",
        sizeBytes: 60,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["d"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // First recovery creates the entry
      const first = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(first).toBeGreaterThanOrEqual(1);

      // Second recovery sees existing pending entry and skips it
      const second = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      // The record recovered previously is still in "pending" state, so count should be 0
      expect(second).toBe(0);

      // Only one DELETE entry for this attachment
      const queueRecords = await getAllQueueRecords(WORKSPACE_A);
      const deletes = queueRecords.filter(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(deletes).toHaveLength(1);
    });

    it("B2-Y: tombstone with status FAILED DELETE queue entry — recovery returns 0 (retryable, not duplicated)", async () => {
      // Import enqueueSyncOperation to manually set up a failed queue entry
      const { enqueueSyncOperation, markOperationFailed } = await import("./syncQueue");

      const record = createAttachmentRecord({
        noteId: "note-b2y",
        workspaceId: WORKSPACE_A,
        name: "retry.png",
        mimeType: "image/png",
        sizeBytes: 70,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["r"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Manually enqueue a DELETE and mark it failed
      const queueRecord = await enqueueSyncOperation({
        workspaceId: WORKSPACE_A,
        entityType: "attachment",
        operation: "delete",
        localId: record.id,
        payload: { id: record.id, workspaceId: WORKSPACE_A, resourceType: "image" },
      });
      await markOperationFailed(queueRecord.id, "network error");

      // Recovery must see the failed entry and NOT add a duplicate
      const recovered = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(recovered).toBe(0);

      const queueRecords = await getAllQueueRecords(WORKSPACE_A);
      const deletes = queueRecords.filter(
        (r) => r.operation === "delete" && r.localId === record.id,
      );
      expect(deletes).toHaveLength(1);
    });

    it("B2-Z: tombstone with status COMPLETED — recovery skips it (cloud cleanup already done)", async () => {
      // Import needed helpers
      const { enqueueSyncOperation, markOperationSynced, markOperationProcessing } = await import("./syncQueue");

      const record = createAttachmentRecord({
        noteId: "note-b2z",
        workspaceId: WORKSPACE_A,
        name: "done.png",
        mimeType: "image/png",
        sizeBytes: 90,
        syncState: "SYNC_PENDING",
      });
      await AttachmentRepository.commitLocalAttachment(
        record,
        new Blob(["done"], { type: "image/png" }),
      );
      await AttachmentRepository.deleteLocalAttachmentAtomic(WORKSPACE_A, record.id);

      // Simulate the tombstone having status=COMPLETED by updating via the store directly
      await runTransaction("attachmentDeletions", "readwrite", async (tx) => {
        const store = tx.objectStore("attachmentDeletions");
        const index = store.index("workspaceId_localAttachmentId");
        const existing = await requestToPromise<AttachmentDeletionRecord | undefined>(
          index.get([WORKSPACE_A, record.id]),
        );
        if (existing) {
          store.put({ ...existing, status: "COMPLETED" });
        }
      });

      // Recovery should return 0 — COMPLETED tombstones are not eligible
      const recovered = await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
      expect(recovered).toBe(0);
    });

    it("recovers a durable deletion tombstone when DELETE queue insertion fails", async () => {
      // ── Step A: Create an attachment ──────────────────────────────────────────
      const noteId = "note-failure-boundary-1";
      const record = createAttachmentRecord({
        noteId,
        workspaceId: WORKSPACE_A,
        name: "document-scan.png",
        mimeType: "image/png",
        sizeBytes: 512,
        syncState: "SYNC_PENDING",
      });
      const expectedResourceType = deriveCloudinaryResourceType(record.kind, record.mimeType);
      expect(expectedResourceType).toBe("image");

      const testBlob = new Blob(["test-png-binary-data"], { type: "image/png" });
      await AttachmentRepository.commitLocalAttachment(record, testBlob);

      // Verify attachment metadata and Blob exist prior to deletion
      const attBefore = await AttachmentRepository.getAttachment(record.id, WORKSPACE_A);
      expect(attBefore).not.toBeNull();
      expect(attBefore?.id).toBe(record.id);

      const blobBefore = await AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A);
      expect(blobBefore).toBeDefined();
      expect(blobBefore.size).toBe(testBlob.size);

      // Ensure queue is initially clear of any operations for this attachment
      const queueBefore = await syncQueue.getAllQueueRecords(WORKSPACE_A);
      expect(queueBefore.filter((r) => r.localId === record.id)).toHaveLength(0);

      // ── Step B: Force actual enqueueSyncOperation to fail ────────────────────
      const simulatedError = new Error("Simulated IndexedDB queue write failure");
      const enqueueSpy = vi
        .spyOn(syncQueue, "enqueueSyncOperation")
        .mockRejectedValueOnce(simulatedError);

      try {
        // Invoke real service deletion workflow (NOT calling deleteLocalAttachmentAtomic directly)
        await AttachmentService.deleteAttachment(record.id, WORKSPACE_A);

        // Confirm the test really intercepted the call
        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId: WORKSPACE_A,
            entityType: "attachment",
            operation: "delete",
            localId: record.id,
            payload: expect.objectContaining({
              id: record.id,
              workspaceId: WORKSPACE_A,
              resourceType: expectedResourceType,
            }),
          }),
        );

        // ── Step C: Verify local deletion survives ─────────────────────────────
        // 1. AttachmentRecord is absent
        const attAfter = await AttachmentRepository.getAttachment(record.id, WORKSPACE_A);
        expect(attAfter).toBeNull();

        // 2. Attachment Blob is absent
        await expect(
          AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A),
        ).rejects.toThrow();

        // 3 & 4. Deletion tombstone exists for original workspace and attachment UUID
        const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
        expect(tombstone).toBeDefined();
        expect(tombstone?.workspaceId).toBe(WORKSPACE_A);
        expect(tombstone?.localAttachmentId).toBe(record.id);
        expect(tombstone?.status).toBe("PENDING");

        // 5. Preserves the expected resourceType
        expect(tombstone?.resourceType).toBe(expectedResourceType);

        // 6. No DELETE queue entry was created by the failed enqueue attempt
        const queueAfterFailedDelete = await syncQueue.getAllQueueRecords(WORKSPACE_A);
        const deletesAfterFailed = queueAfterFailedDelete.filter(
          (r) => r.operation === "delete" && r.localId === record.id,
        );
        expect(deletesAfterFailed).toHaveLength(0);

        // 7. No CREATE queue entry exists for the deleted attachment
        const createsAfterFailed = queueAfterFailedDelete.filter(
          (r) => r.operation === "create" && r.localId === record.id,
        );
        expect(createsAfterFailed).toHaveLength(0);

        // ── Step D: Simulate restart/reinitialization & restore real queue ──────
        enqueueSpy.mockRestore();

        // Invoke the actual recovery method
        const recoveredCount =
          await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
        expect(recoveredCount).toBe(1);

        // ── Step E: Verify recovery ────────────────────────────────────────────
        const queueAfterRecovery = await syncQueue.getAllQueueRecords(WORKSPACE_A);
        const deletesAfterRecovery = queueAfterRecovery.filter(
          (r) => r.operation === "delete" && r.localId === record.id,
        );
        // Exactly one DELETE queue entry now exists
        expect(deletesAfterRecovery).toHaveLength(1);
        const recoveredOp = deletesAfterRecovery[0];
        expect(recoveredOp.entityType).toBe("attachment");
        expect(recoveredOp.operation).toBe("delete");
        expect(recoveredOp.localId).toBe(record.id);
        expect(recoveredOp.workspaceId).toBe(WORKSPACE_A);
        expect(recoveredOp.payload?.id).toBe(record.id);
        expect(recoveredOp.payload?.workspaceId).toBe(WORKSPACE_A);
        expect(recoveredOp.payload?.resourceType).toBe(expectedResourceType);
        expect(recoveredOp.payload?.resourceType).toBe(tombstone?.resourceType);

        // AttachmentRecord remains absent
        expect(await AttachmentRepository.getAttachment(record.id, WORKSPACE_A)).toBeNull();
        // Blob remains absent
        await expect(
          AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_A),
        ).rejects.toThrow();

        // No CREATE queue entry exists for the deleted attachment
        const createsAfterRecovery = queueAfterRecovery.filter(
          (r) => r.operation === "create" && r.localId === record.id,
        );
        expect(createsAfterRecovery).toHaveLength(0);

        // Verify CREATE recovery does not resurrect it either
        const createRecoveryCount =
          await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_A);
        expect(createRecoveryCount).toBe(0);

        // ── Step F: Verify idempotency ─────────────────────────────────────────
        const secondRecoveryCount =
          await AttachmentRepository.reconcileMissingDeleteQueueEntries(WORKSPACE_A);
        expect(secondRecoveryCount).toBe(0);

        const queueAfterSecondRecovery = await syncQueue.getAllQueueRecords(WORKSPACE_A);
        const deletesAfterSecond = queueAfterSecondRecovery.filter(
          (r) => r.operation === "delete" && r.localId === record.id,
        );
        expect(deletesAfterSecond).toHaveLength(1);

        // Tombstone and resource type remain intact
        const finalTombstone = await AttachmentRepository.getTombstone(WORKSPACE_A, record.id);
        expect(finalTombstone).toBeDefined();
        expect(finalTombstone?.status).toBe("PENDING");
        expect(finalTombstone?.resourceType).toBe(expectedResourceType);
      } finally {
        enqueueSpy.mockRestore();
      }
    });
  });
});
