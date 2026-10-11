import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import "fake-indexeddb/auto";

vi.mock("./connectivityService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./connectivityService")>();
  return {
    ...actual,
    isOnline: vi.fn(() => true),
    initConnectivityService: vi.fn(async () => {}),
    onConnectivityChange: vi.fn(() => () => {}),
  };
});

import { AttachmentService } from "./attachmentService";
import { AttachmentRepository } from "./attachmentRepository";
import { SyncService } from "./syncService";
import { getAllQueueRecords, enqueueSyncOperation } from "./syncQueue";
import {
  requestCloudinaryUploadAuth,
  uploadBlobToCloudinary,
  requestCloudinaryDeletion,
} from "./cloudinaryUploadService";
import * as cloudinaryService from "./cloudinaryUploadService";
import * as authService from "./authService";
import type { CloudSyncAdapter } from "./syncTypes";

const WORKSPACE_TEST = "ws-phase4b3-test";

describe("Phase 4B.3: Browser-Direct Cloudinary Attachment Upload Integration Suite", () => {
  beforeEach(async () => {
    // Reset IndexedDB state
    const req = indexedDB.deleteDatabase("aymo_local");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });

    const syncService = SyncService.getInstance();
    syncService.destroy();
    (SyncService as any)._instance = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Successful signed authorization and browser-direct upload
  it("1. requests signed authorization and uploads binary directly to Cloudinary", async () => {
    const file = new File(["photo bytes"], "photo.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-1", WORKSPACE_TEST);

    const mockAuthResponse = {
      cloudName: "aymo-cloud",
      apiKey: "123456789",
      timestamp: 1700000000,
      publicId: `aymo/workspaces/${WORKSPACE_TEST}/${record.id}`,
      folder: `aymo/workspaces/${WORKSPACE_TEST}`,
      resourceType: "image" as const,
      signature: "mock-sig-abc",
      uploadUrl: "https://api.cloudinary.com/v1_1/aymo-cloud/image/upload",
    };

    const authSpy = vi
      .spyOn(cloudinaryService, "requestCloudinaryUploadAuth")
      .mockResolvedValue(mockAuthResponse);

    const uploadSpy = vi
      .spyOn(cloudinaryService, "uploadBlobToCloudinary")
      .mockResolvedValue({
        publicId: mockAuthResponse.publicId,
        secureUrl: "https://res.cloudinary.com/aymo-cloud/image/upload/v1/photo.png",
        resourceType: "image",
      });

    let pushedPayload: any = null;
    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async (op) => {
        pushedPayload = op.payload;
        return { remoteId: `mongo-${op.localId}` };
      },
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    const res = await syncService.performSync();
    expect(res.success).toBe(true);

    expect(authSpy).toHaveBeenCalledWith(
      WORKSPACE_TEST,
      record.id,
      "image/png",
      file.size,
    );
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    // Verify metadata push to MongoDB contained remoteUrl and storageKey
    expect(pushedPayload).toBeDefined();
    expect(pushedPayload.remoteUrl).toBe("https://res.cloudinary.com/aymo-cloud/image/upload/v1/photo.png");
    expect(pushedPayload.storageKey).toBe(mockAuthResponse.publicId);

    // Verify local record updated
    const local = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(local?.syncState).toBe("SYNCED");
    expect(local?.remoteUrl).toBe("https://res.cloudinary.com/aymo-cloud/image/upload/v1/photo.png");
    expect(local?.cloudinaryPublicId).toBe(mockAuthResponse.publicId);
  });

  // 2. Correct Cloudinary form fields and resource types
  it("2. packages correct FormData fields and uploadUrl in uploadBlobToCloudinary", async () => {
    const blob = new Blob(["video data"], { type: "video/mp4" });
    const auth = {
      cloudName: "test-cloud",
      apiKey: "key-999",
      timestamp: 1600000000,
      publicId: "aymo/workspaces/ws-1/att-1",
      folder: "aymo/workspaces/ws-1",
      resourceType: "video" as const,
      signature: "sig-xyz",
      uploadUrl: "https://api.cloudinary.com/v1_1/test-cloud/video/upload",
    };

    let fetchUrl = "";
    // Use a mutable object rather than a plain `let` variable to prevent
    // TypeScript's control-flow analysis from narrowing the type to `never`
    // after a falsy guard, which happens because TypeScript conservatively
    // assumes async callbacks assigned to mocked globals may never be invoked.
    const captured: { body: FormData | null } = { body: null };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      fetchUrl = String(url);
      captured.body = init?.body as FormData;
      return new Response(
        JSON.stringify({
          public_id: auth.publicId,
          secure_url: "https://res.cloudinary.com/video.mp4",
          resource_type: "video",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    try {
      const result = await uploadBlobToCloudinary(blob, auth);
      expect(result.publicId).toBe(auth.publicId);
      expect(result.secureUrl).toBe("https://res.cloudinary.com/video.mp4");
      expect(fetchUrl).toBe(auth.uploadUrl);

      expect(captured.body).not.toBeNull();
      if (!captured.body) throw new Error("Expected fetch body to be captured by the mock");
      expect(captured.body.get("api_key")).toBe(auth.apiKey);
      expect(captured.body.get("timestamp")).toBe(String(auth.timestamp));
      expect(captured.body.get("signature")).toBe(auth.signature);
      expect(captured.body.get("folder")).toBe(auth.folder);
      expect(captured.body.get("public_id")).toBe(auth.publicId);
      expect(captured.body.get("overwrite")).toBe("true");
      expect(captured.body.get("unique_filename")).toBe("false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 3. Link attachments bypassing Cloudinary
  it("3. bypasses Cloudinary upload completely for link attachments", async () => {
    const linkRecord = await AttachmentService.createLinkAttachment(
      "https://example.com/spec.pdf",
      "Spec Link",
      "note-link",
      WORKSPACE_TEST,
    );

    const authSpy = vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth");
    const uploadSpy = vi.spyOn(cloudinaryService, "uploadBlobToCloudinary");

    let pushCount = 0;
    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => {
        pushCount++;
        return { remoteId: "mongo-link-1" };
      },
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    // Link must not trigger Cloudinary calls
    expect(authSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(pushCount).toBe(1);

    const updated = await AttachmentRepository.getAttachment(linkRecord.id, WORKSPACE_TEST);
    expect(updated?.syncState).toBe("SYNCED");
  });

  // 4. Cloudinary failure preserving local attachment data
  it("4. handles Cloudinary upload failure gracefully, preserving local Blob and metadata with SYNC_FAILED", async () => {
    const file = new File(["important data"], "data.pdf", { type: "application/pdf" });
    const record = await AttachmentService.createAttachment(file, "note-4", WORKSPACE_TEST);

    vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 100,
      publicId: `p-${record.id}`,
      folder: "f",
      resourceType: "raw",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockRejectedValue(
      new Error("Cloudinary 503 Server Unavailable"),
    );

    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => ({ remoteId: "r1" }),
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    // Local Blob and metadata must still be intact
    const blob = await AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_TEST);
    expect(blob).toBeDefined();
    expect(blob.size).toBe(file.size);

    const local = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(local?.localState).toBe("LOCAL_READY");
    expect(local?.syncState).toBe("SYNC_FAILED");
    expect(local?.lastSyncError).toContain("Cloudinary 503");
  });

  // 5. Successful upload persisting the remote result
  it("5. persists remote result (cloudinaryPublicId & remoteUrl) in IndexedDB upon successful upload", async () => {
    const file = new File(["image data"], "art.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-5", WORKSPACE_TEST);

    vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 200,
      publicId: `pub-${record.id}`,
      folder: "f",
      resourceType: "image",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockResolvedValue({
      publicId: `pub-${record.id}`,
      secureUrl: "https://cdn.cloudinary.com/art.png",
      resourceType: "image",
    });

    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => ({ remoteId: `mongo-${record.id}` }),
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    const local = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(local?.cloudinaryPublicId).toBe(`pub-${record.id}`);
    expect(local?.remoteUrl).toBe("https://cdn.cloudinary.com/art.png");
    expect(local?.remoteId).toBe(`mongo-${record.id}`);
  });

  // 6. MongoDB metadata failure retrying without unnecessary binary re-upload
  it("6. skips re-uploading binary on retry when Cloudinary succeeded but MongoDB push failed", async () => {
    const file = new File(["code bytes"], "script.py", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-6", WORKSPACE_TEST);

    vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 300,
      publicId: `pub-${record.id}`,
      folder: "f",
      resourceType: "raw",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    const uploadSpy = vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockResolvedValue({
      publicId: `pub-${record.id}`,
      secureUrl: "https://cdn.cloudinary.com/script.py",
      resourceType: "raw",
    });

    let shouldFailPush = true;
    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => {
        if (shouldFailPush) {
          throw new Error("MongoDB connection dropped");
        }
        return { remoteId: `mongo-${record.id}` };
      },
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    // Pass 1: Cloudinary upload succeeds, but MongoDB push fails
    await syncService.performSync();
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    const intermediate = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(intermediate?.syncState).toBe("SYNC_FAILED");
    expect(intermediate?.cloudinaryPublicId).toBe(`pub-${record.id}`);
    expect(intermediate?.remoteUrl).toBe("https://cdn.cloudinary.com/script.py");

    // Pass 2: Retry with working MongoDB connection
    shouldFailPush = false;
    await syncService.performSync();

    // Must NOT call uploadBlobToCloudinary a second time
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    const finalRec = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(finalRec?.syncState).toBe("SYNCED");
    expect(finalRec?.remoteId).toBe(`mongo-${record.id}`);
  });

  // 7. Recovery when Cloudinary succeeds but browser fails before persisting result
  it("7. safely handles retry with deterministic public_id when prior pass was interrupted", async () => {
    const file = new File(["raw bytes"], "data.bin", { type: "application/octet-stream" });
    const record = await AttachmentService.createAttachment(file, "note-7", WORKSPACE_TEST);

    const authSpy = vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 400,
      publicId: `aymo/workspaces/${WORKSPACE_TEST}/${record.id}`,
      folder: `aymo/workspaces/${WORKSPACE_TEST}`,
      resourceType: "raw",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    const uploadSpy = vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockResolvedValue({
      publicId: `aymo/workspaces/${WORKSPACE_TEST}/${record.id}`,
      secureUrl: "https://cdn.cloudinary.com/data.bin",
      resourceType: "raw",
    });

    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => ({ remoteId: "m7" }),
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    expect(authSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  // 8. Duplicate or concurrent processing of the same attachment
  it("8. prevents concurrent passes from duplicating uploads or writes", async () => {
    const file = new File(["concurrent bytes"], "file.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-8", WORKSPACE_TEST);

    vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 500,
      publicId: `pub-${record.id}`,
      folder: "f",
      resourceType: "raw",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    const uploadSpy = vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockResolvedValue({
      publicId: `pub-${record.id}`,
      secureUrl: "https://cdn.cloudinary.com/file.txt",
      resourceType: "raw",
    });

    let pushCount = 0;
    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => {
        pushCount++;
        return { remoteId: `mongo-${record.id}` };
      },
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    // Invoke sync concurrently twice
    await Promise.all([syncService.performSync(), syncService.performSync()]);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(pushCount).toBe(1);
  });

  // 9. Deletion before upload
  it("9. aborts CREATE operation and skips Cloudinary upload if attachment is already tombstoned", async () => {
    const file = new File(["to delete"], "del_first.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-9", WORKSPACE_TEST);

    // Delete locally before sync runs
    await AttachmentService.deleteAttachment(record.id, WORKSPACE_TEST);

    const authSpy = vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth");
    const uploadSpy = vi.spyOn(cloudinaryService, "uploadBlobToCloudinary");

    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => ({ remoteId: "m9" }),
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    // Must never upload a deleted attachment
    expect(authSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  // 10. Deletion during upload
  it("10. detects deletion that occurred during upload and prevents resurrection", async () => {
    const file = new File(["mid delete"], "mid.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-10", WORKSPACE_TEST);

    vi.spyOn(cloudinaryService, "requestCloudinaryUploadAuth").mockResolvedValue({
      cloudName: "c",
      apiKey: "k",
      timestamp: 600,
      publicId: `pub-${record.id}`,
      folder: "f",
      resourceType: "image",
      signature: "s",
      uploadUrl: "https://upload.url",
    });

    vi.spyOn(cloudinaryService, "uploadBlobToCloudinary").mockImplementation(async () => {
      // Simulate user deleting attachment while upload was in flight
      await AttachmentService.deleteAttachment(record.id, WORKSPACE_TEST);
      return {
        publicId: `pub-${record.id}`,
        secureUrl: "https://cdn.cloudinary.com/mid.png",
        resourceType: "image",
      };
    });

    let pushCalled = false;
    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => {
        pushCalled = true;
        return { remoteId: "m10" };
      },
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    // Must NOT push CREATE metadata to MongoDB
    expect(pushCalled).toBe(false);

    // Attachment must NOT be resurrected in IndexedDB
    const att = await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST);
    expect(att).toBeNull();

    // Tombstone must still be present and updated with public ID for cleanup
    const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_TEST, record.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.cloudinaryPublicId).toBe(`pub-${record.id}`);
  });

  // 11. Late upload completion after deletion
  it("11. prevents late upload response from restoring deleted Blob or metadata", async () => {
    const file = new File(["late data"], "late.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-11", WORKSPACE_TEST);

    await AttachmentService.deleteAttachment(record.id, WORKSPACE_TEST);

    // Verify metadata and blob are absent
    expect(await AttachmentRepository.getAttachment(record.id, WORKSPACE_TEST)).toBeNull();
    await expect(
      AttachmentRepository.getAttachmentBlob(record.id, WORKSPACE_TEST),
    ).rejects.toThrow();

    const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_TEST, record.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.status).toBe("PENDING");
  });

  // 12. Existing Phase 4B.2 tombstone and DELETE queue recovery
  it("12. completes remote deletion and transitions tombstone status to COMPLETED", async () => {
    const file = new File(["del cleanup"], "clean.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-12", WORKSPACE_TEST);

    await AttachmentService.deleteAttachment(record.id, WORKSPACE_TEST);

    const deleteSpy = vi
      .spyOn(cloudinaryService, "requestCloudinaryDeletion")
      .mockResolvedValue({
        status: "deleted",
        attachmentId: record.id,
        cloudinaryPublicId: `pub-${record.id}`,
      });

    const mockAdapter: CloudSyncAdapter = {
      provider: "mongodb",
      isAvailable: async () => true,
      pushOperation: async () => ({ remoteId: "m12" }),
      fetchChanges: async () => [],
      resolveConflict: async () => "local-wins",
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_TEST);
    syncService.registerAdapter(mockAdapter);

    await syncService.performSync();

    expect(deleteSpy).toHaveBeenCalledWith(WORKSPACE_TEST, record.id);

    const tombstone = await AttachmentRepository.getTombstone(WORKSPACE_TEST, record.id);
    expect(tombstone?.status).toBe("COMPLETED");
  });

  // 13. Existing offline and logged-out local attachment creation
  it("13. creates and reads local attachments while logged out without network requests", async () => {
    vi.spyOn(authService, "loadAuthToken").mockReturnValue(null);

    const file = new File(["offline binary"], "local_only.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-13", WORKSPACE_TEST);

    expect(record.id).toBeDefined();
    expect(record.localState).toBe("LOCAL_READY");

    const blob = await AttachmentService.getAttachmentBlob(record.id, WORKSPACE_TEST);
    expect(blob).toBeDefined();
    expect(blob.size).toBe(file.size);

    const list = await AttachmentService.listAttachments("note-13", WORKSPACE_TEST);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(record.id);
  });
});
