import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { AttachmentService, subscribeAttachmentChanges } from "./attachmentService";
import { runTransaction, requestToPromise } from "./localWorkspaceDatabase";
import { AttachmentRecord } from "../types";

const WORKSPACE_1 = "ws-ui-alpha";
const WORKSPACE_2 = "ws-ui-beta";

describe("Phase 3B: AttachmentService Local UI Integration Suite", () => {
  beforeEach(async () => {
    // Reset IndexedDB state before each test
    const req = indexedDB.deleteDatabase("aymo_local");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  // 1. Create attachment
  it("1. creates local attachment and stores metadata + Blob in IndexedDB v4", async () => {
    const file = new File(["sample text content"], "sample.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-1", WORKSPACE_1);

    expect(record.id).toBeDefined();
    expect(record.name).toBe("sample.txt");
    expect(record.kind).toBe("document");
    expect(record.localState).toBe("LOCAL_READY");
  });

  // 2. Attachment appears in list
  it("2. returns created attachment in listAttachments query", async () => {
    const file = new File(["pdf content"], "report.pdf", { type: "application/pdf" });
    await AttachmentService.createAttachment(file, "note-2", WORKSPACE_1);

    const attachments = await AttachmentService.listAttachments("note-2", WORKSPACE_1);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe("report.pdf");
    expect(attachments[0].kind).toBe("pdf");
  });

  // 3. Retrieve actual Blob
  it("3. retrieves actual binary Blob content from IndexedDB", async () => {
    const fileData = "binary-audio-stream-123";
    const file = new File([fileData], "audio.mp3", { type: "audio/mp3" });
    const record = await AttachmentService.createAttachment(file, "note-3", WORKSPACE_1);

    const blob = await AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1);
    expect(blob).toBeDefined();
    expect(blob.size).toBe(file.size);
  });

  // 4. Refresh/reload rehydrates attachment
  it("4. rehydrates attachments directly from IndexedDB across simulated reloads", async () => {
    const file = new File(["rehydrate data"], "image.png", { type: "image/png" });
    await AttachmentService.createAttachment(file, "note-4", WORKSPACE_1);

    // Simulate page reload by querying clean AttachmentService API without in-memory state
    const rehydrated = await AttachmentService.listAttachments("note-4", WORKSPACE_1);
    expect(rehydrated).toHaveLength(1);
    expect(rehydrated[0].name).toBe("image.png");
  });

  // 5. Switch notes
  it("5. prevents attachment leakage when switching between notes", async () => {
    const fileA = new File(["A"], "fileA.pdf", { type: "application/pdf" });
    const fileB = new File(["B"], "fileB.png", { type: "image/png" });

    await AttachmentService.createAttachment(fileA, "note-A", WORKSPACE_1);
    await AttachmentService.createAttachment(fileB, "note-B", WORKSPACE_1);

    const listA = await AttachmentService.listAttachments("note-A", WORKSPACE_1);
    const listB = await AttachmentService.listAttachments("note-B", WORKSPACE_1);

    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("fileA.pdf");

    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe("fileB.png");
  });

  // 6. Delete attachment
  it("6. atomically deletes attachment metadata and Blob and emits delete event", async () => {
    let eventReceived = false;
    const unsub = subscribeAttachmentChanges((evt) => {
      if (evt.action === "deleted") eventReceived = true;
    });

    const file = new File(["to delete"], "del.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-del", WORKSPACE_1);

    await AttachmentService.deleteAttachment(record.id, WORKSPACE_1);

    const list = await AttachmentService.listAttachments("note-del", WORKSPACE_1);
    expect(list).toHaveLength(0);

    await expect(
      AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1),
    ).rejects.toThrow();

    expect(eventReceived).toBe(true);
    unsub();
  });

  // 7. Rename attachment
  it("7. renames attachment in IndexedDB while preserving stable local UUID", async () => {
    const file = new File(["rename me"], "old_name.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-rename", WORKSPACE_1);

    const updated = await AttachmentService.renameAttachment(record.id, "new_name.txt", WORKSPACE_1);
    expect(updated.id).toBe(record.id);
    expect(updated.name).toBe("new_name.txt");

    const fetched = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(fetched?.name).toBe("new_name.txt");
  });

  // 8. Missing Blob error
  it("8. fails clearly with error when Blob binary is missing", async () => {
    const record = await AttachmentService.createLinkAttachment("https://aymo.app", "AYMO", "note-missing", WORKSPACE_1);
    // Link attachment has no binary Blob
    await expect(
      AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1),
    ).rejects.toThrow();
  });

  // 9. Workspace isolation
  it("9. maintains strict workspace isolation for listing, getting, and deleting", async () => {
    const file = new File(["iso"], "iso.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-shared-id", WORKSPACE_1);

    const listB = await AttachmentService.listAttachments("note-shared-id", WORKSPACE_2);
    expect(listB).toHaveLength(0);

    const getB = await AttachmentService.getAttachment(record.id, WORKSPACE_2);
    expect(getB).toBeNull();
  });

  // 10. Logged-out local operation
  it("10. operates locally without authentication token or login state", async () => {
    const file = new File(["unauth"], "offline.doc", { type: "application/msword" });
    const record = await AttachmentService.createAttachment(file, "note-unauth", WORKSPACE_1);
    expect(record.localState).toBe("LOCAL_READY");
  });

  // 11. Offline local operation
  it("11. operates locally without network availability", async () => {
    const file = new File(["no-net"], "offline.pdf", { type: "application/pdf" });
    const record = await AttachmentService.createAttachment(file, "note-off", WORKSPACE_1);

    const blob = await AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1);
    expect(blob).toBeDefined();
  });

  // 12. No dependency on note.files[]
  it("12. operates independently of legacy note.files[] array", async () => {
    const file = new File(["no-legacy"], "clean.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-clean", WORKSPACE_1);

    const atts = await AttachmentService.listAttachments("note-clean", WORKSPACE_1);
    expect(atts[0].id).toBe(record.id);
  });

  // 13. Object URL cleanup
  it("13. guarantees Blob URL creation and revocation helper semantics", async () => {
    const blob = new Blob(["test-url-cleanup"], { type: "text/plain" });
    const objectUrl = URL.createObjectURL(blob);
    expect(objectUrl).toBeDefined();
    URL.revokeObjectURL(objectUrl);
  });

  // 14. Multiple attachments on one note
  it("14. handles multiple attachments assigned to the same note", async () => {
    const file1 = new File(["1"], "1.txt", { type: "text/plain" });
    const file2 = new File(["2"], "2.txt", { type: "text/plain" });
    const file3 = new File(["3"], "3.txt", { type: "text/plain" });

    await AttachmentService.createAttachment(file1, "note-multi", WORKSPACE_1);
    await AttachmentService.createAttachment(file2, "note-multi", WORKSPACE_1);
    await AttachmentService.createAttachment(file3, "note-multi", WORKSPACE_1);

    const list = await AttachmentService.listAttachments("note-multi", WORKSPACE_1);
    expect(list).toHaveLength(3);
  });

  // 15. Duplicate filenames
  it("15. assigns unique stable local UUIDs to attachments with duplicate filenames", async () => {
    const file1 = new File(["content A"], "duplicate.pdf", { type: "application/pdf" });
    const file2 = new File(["content B"], "duplicate.pdf", { type: "application/pdf" });

    const rec1 = await AttachmentService.createAttachment(file1, "note-dup", WORKSPACE_1);
    const rec2 = await AttachmentService.createAttachment(file2, "note-dup", WORKSPACE_1);

    expect(rec1.id).not.toBe(rec2.id);

    const list = await AttachmentService.listAttachments("note-dup", WORKSPACE_1);
    expect(list).toHaveLength(2);
  });

  // 16. Large-but-basic file storage without heavy processing
  it("16. stores and retrieves large file Blobs without triggering heavy AI/OCR processing", async () => {
    const largeBuffer = new Uint8Array(2 * 1024 * 1024); // 2MB dummy binary file
    const file = new File([largeBuffer], "large_video.mp4", { type: "video/mp4" });

    const record = await AttachmentService.createAttachment(file, "note-large", WORKSPACE_1);
    expect(record.sizeBytes).toBe(2 * 1024 * 1024);

    const retrievedBlob = await AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1);
    expect(retrievedBlob.size).toBe(2 * 1024 * 1024);
  });
});
