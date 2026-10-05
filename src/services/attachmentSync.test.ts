import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// ── Mock connectivity so performSync() doesn't bail with "You're offline" ─────
// The jsdom test environment has no real navigator.onLine, so isOnline()
// returns false unless we override it here.
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
import { getPendingOperations, getAllQueueRecords } from "./syncQueue";
import { getRemoteMapping } from "./remoteMapping";

const WORKSPACE_1 = "ws-phase4a-alpha";
const WORKSPACE_2 = "ws-phase4a-beta";

describe("Phase 4A: Local-to-Cloud Synchronization Foundation Suite", () => {
  beforeEach(async () => {
    const syncService = SyncService.getInstance();
    syncService.destroy();
    (SyncService as any)._instance = null;

    // Reset IndexedDB state before each test
    const req = indexedDB.deleteDatabase("aymo_local");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  // 1. Local creation enqueues durable sync operation
  it("1. creates local attachment and enqueues SYNC_PENDING operation in syncQueue", async () => {
    const file = new File(["local data"], "sync_test.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-sync-1", WORKSPACE_1);

    expect(record.id).toBeDefined();
    expect(record.syncState).toBe("SYNC_PENDING");

    const pending = await getPendingOperations(WORKSPACE_1, 50);
    const attachmentOps = pending.filter((op) => op.localId === record.id && op.entityType === "attachment");

    expect(attachmentOps).toHaveLength(1);
    expect(attachmentOps[0].operation).toBe("create");
    expect(attachmentOps[0].payload.name).toBe("sync_test.txt");
  });

  // 2. Successful sync push creates remote mapping and sets SYNCED
  it("2. pushes pending attachment to cloud, stores remote mapping, and updates syncState to SYNCED", async () => {
    const file = new File(["cloud push content"], "remote.pdf", { type: "application/pdf" });
    const record = await AttachmentService.createAttachment(file, "note-sync-2", WORKSPACE_1);

    // Mock adapter that returns remote ID
    const mockAdapter: any = {
      provider: "mongodb",
      pushOperation: async (rec: any) => ({ remoteId: `remote-${rec.localId}` }),
      fetchChanges: async () => [],
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);
    syncService.registerAdapter(mockAdapter);
    // Do NOT call start() here — it triggers a background pass that races with performSync()

    // Perform sync
    const res = await syncService.performSync();
    expect(res.success).toBe(true);
    expect(res.pushedCount).toBeGreaterThan(0);

    // Verify remote mapping
    const mapping = await getRemoteMapping(WORKSPACE_1, "attachment", record.id);
    expect(mapping).not.toBeNull();
    expect(mapping?.remoteId).toBe(`remote-${record.id}`);

    // Verify local attachment syncState
    const updated = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(updated?.syncState).toBe("SYNCED");
    expect(updated?.remoteId).toBe(`remote-${record.id}`);
  });

  // 3. Cloud failure leaves local data safe in IndexedDB with SYNC_FAILED
  it("3. handles cloud sync failure gracefully, leaving local attachment safe and readable with SYNC_FAILED", async () => {
    const file = new File(["important offline document"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const record = await AttachmentService.createAttachment(file, "note-fail-3", WORKSPACE_1);

    // Mock failing adapter
    const failingAdapter: any = {
      provider: "mongodb",
      pushOperation: async () => {
        throw new Error("Network timeout / 503 Server Error");
      },
      fetchChanges: async () => [],
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);
    syncService.registerAdapter(failingAdapter);
    // Do NOT call start() here — it triggers a background pass that races with performSync()

    await syncService.performSync();

    // Verify local attachment binary Blob and metadata remain 100% readable
    const blob = await AttachmentService.getAttachmentBlob(record.id, WORKSPACE_1);
    expect(blob).toBeDefined();
    expect(blob.size).toBe(file.size);

    const att = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(att?.localState).toBe("LOCAL_READY");
    expect(att?.syncState).toBe("SYNC_FAILED");
    expect(att?.lastSyncError).toContain("Network timeout");
  });

  // 4. Pending queue items survive simulated browser refresh
  it("4. preserves pending syncQueue operations across browser reloads / restarts", async () => {
    const file = new File(["refresh data"], "offline_photo.png", { type: "image/png" });
    const record = await AttachmentService.createAttachment(file, "note-refresh-4", WORKSPACE_1);

    // Simulate page reload by reading queue from new database connection
    const allRecords = await getAllQueueRecords(WORKSPACE_1);
    const queueItem = allRecords.find((r) => r.localId === record.id);

    expect(queueItem).toBeDefined();
    expect(queueItem?.status).toBe("pending");
    expect(queueItem?.entityType).toBe("attachment");
  });

  // 5. Workspace isolation for sync operations
  it("5. keeps sync queue entries isolated per workspace", async () => {
    const file1 = new File(["ws1"], "file1.txt", { type: "text/plain" });
    const file2 = new File(["ws2"], "file2.txt", { type: "text/plain" });

    const rec1 = await AttachmentService.createAttachment(file1, "note-ws1", WORKSPACE_1);
    const rec2 = await AttachmentService.createAttachment(file2, "note-ws2", WORKSPACE_2);

    const ops1 = await getPendingOperations(WORKSPACE_1, 50);
    const ops2 = await getPendingOperations(WORKSPACE_2, 50);

    expect(ops1.some((op) => op.localId === rec1.id)).toBe(true);
    expect(ops1.some((op) => op.localId === rec2.id)).toBe(false);

    expect(ops2.some((op) => op.localId === rec2.id)).toBe(true);
    expect(ops2.some((op) => op.localId === rec1.id)).toBe(false);
  });

  // 6. Unauthenticated creation followed by login and sync
  it("6. preserves local UUID when authenticating and syncing previously unauthenticated attachment", async () => {
    // Step 1: Unauthenticated attachment creation
    const file = new File(["unauth file"], "unauth.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-auth-6", WORKSPACE_1);
    const originalLocalId = record.id;

    // Step 2: Login occurs -> Register adapter
    const mockAdapter: any = {
      provider: "mongodb",
      pushOperation: async (rec: any) => ({ remoteId: `mongo-id-${rec.localId}` }),
      fetchChanges: async () => [],
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);
    syncService.registerAdapter(mockAdapter);
    // Do NOT call start() here — it triggers a background pass that races with performSync()

    // Step 3: Trigger sync
    await syncService.performSync();

    // Verify local UUID is completely unchanged
    const syncedAttachment = await AttachmentService.getAttachment(originalLocalId, WORKSPACE_1);
    expect(syncedAttachment?.id).toBe(originalLocalId);
    expect(syncedAttachment?.remoteId).toBe(`mongo-id-${originalLocalId}`);
    expect(syncedAttachment?.syncState).toBe("SYNCED");
  });

  // 7. Concurrent background sync and manual performSync() protection (P1)
  it("7. handles concurrent performSync() and background processQueue without racing or duplicate push errors", async () => {
    const file = new File(["race test"], "race.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-race-7", WORKSPACE_1);

    let pushCount = 0;
    const mockAdapter: any = {
      provider: "mongodb",
      pushOperation: async (rec: any) => {
        pushCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { remoteId: `remote-${rec.localId}` };
      },
      fetchChanges: async () => [],
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);
    syncService.registerAdapter(mockAdapter);

    // Call performSync while start() background loop triggers
    syncService.start();
    const syncRes = await syncService.performSync();

    expect(syncRes.success).toBe(true);
    expect(pushCount).toBe(1);

    const att = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(att?.syncState).toBe("SYNCED");
  });

  // 8. Remote mapping workspace isolation (P3)
  it("8. isolates remote mappings between workspaces even if entity local IDs match", async () => {
    const commonId = "common-uuid-1234";
    const { setRemoteMapping, getRemoteMapping: getRM } = await import("./remoteMapping");

    await setRemoteMapping(WORKSPACE_1, "attachment", commonId, "mongo-ws1");
    await setRemoteMapping(WORKSPACE_2, "attachment", commonId, "mongo-ws2");

    const mappingWs1 = await getRM(WORKSPACE_1, "attachment", commonId);
    const mappingWs2 = await getRM(WORKSPACE_2, "attachment", commonId);

    expect(mappingWs1?.remoteId).toBe("mongo-ws1");
    expect(mappingWs2?.remoteId).toBe("mongo-ws2");

    // Scoped query for WS1 with WS2's ID should return null
    const crossCheck = await getRM(WORKSPACE_1, "attachment", "non-existent-or-other");
    expect(crossCheck).toBeNull();
  });

  // ── P2 Durable Queue Recovery Test Suite (Tests A - H) ──────────────────────

  // Test A — Queue enqueue failure recovery
  it("P2-A. reconstructs missing CREATE queue record when initial enqueueSyncOperation fails", async () => {
    const file = new File(["recovery test"], "rec_test.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-a", WORKSPACE_1);

    // Simulate initial enqueueSyncOperation failure by clearing syncQueue
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });
    await AttachmentRepository.updateAttachment(record.id, WORKSPACE_1, {
      syncState: "SYNC_FAILED",
      lastSyncError: "Simulated queue write error",
    });

    // Verify initial failure state
    let att = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(att?.syncState).toBe("SYNC_FAILED");
    let pendingOps = await getPendingOperations(WORKSPACE_1, 50);
    expect(pendingOps.filter((o) => o.localId === record.id)).toHaveLength(0);

    // Run recovery pass
    const recoveredCount = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    expect(recoveredCount).toBe(1);

    // Verify queue record reconstructed
    pendingOps = await getPendingOperations(WORKSPACE_1, 50);
    const reconstructed = pendingOps.find((o) => o.localId === record.id);
    expect(reconstructed).toBeDefined();
    expect(reconstructed?.operation).toBe("create");
    expect(reconstructed?.entityType).toBe("attachment");

    // Verify attachment state updated to SYNC_PENDING
    att = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(att?.syncState).toBe("SYNC_PENDING");
    expect(att?.lastSyncError).toBeNull();
  });

  // Test B — Recovery survives reinitialization / refresh
  it("P2-B. recovers missing queue entries from durable IDB state upon SyncService initialization", async () => {
    const file = new File(["reinit test"], "reinit.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-b", WORKSPACE_1);

    // Clear syncQueue to simulate missing queue entry
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });
    await AttachmentRepository.updateAttachment(record.id, WORKSPACE_1, {
      syncState: "SYNC_FAILED",
      lastSyncError: "Simulated crash",
    });

    // Reinitialize SyncService (simulating restart)
    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);

    const pendingOps = await getPendingOperations(WORKSPACE_1, 50);
    const found = pendingOps.find((o) => o.localId === record.id);
    expect(found).toBeDefined();
    expect(found?.operation).toBe("create");
  });

  // Test C — Idempotent recovery
  it("P2-C. operates idempotently when executed multiple times without duplicating queue entries", async () => {
    const file = new File(["idempotent test"], "idempotent.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-c", WORKSPACE_1);

    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });
    await AttachmentRepository.updateAttachment(record.id, WORKSPACE_1, {
      syncState: "SYNC_FAILED",
    });

    // Run recovery 3 times
    await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);

    const allRecords = await getAllQueueRecords(WORKSPACE_1);
    const matchingOps = allRecords.filter((o) => o.localId === record.id);
    expect(matchingOps).toHaveLength(1);
  });

  // Test D — Existing queue is not duplicated
  it("P2-D. ignores attachments that already have active queue entries", async () => {
    const file = new File(["active queue test"], "active.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-d", WORKSPACE_1);

    // Run recovery while valid queue entry already exists
    const count = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    expect(count).toBe(0);

    const allRecords = await getAllQueueRecords(WORKSPACE_1);
    const matchingOps = allRecords.filter((o) => o.localId === record.id);
    expect(matchingOps).toHaveLength(1);
  });

  // Test E — Already synced attachment is ignored
  it("P2-E. ignores attachments that are already remotely mapped or SYNCED", async () => {
    const file = new File(["synced test"], "synced.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-e", WORKSPACE_1);

    const { setRemoteMapping } = await import("./remoteMapping");
    await setRemoteMapping(WORKSPACE_1, "attachment", record.id, "remote-mongo-e");
    await AttachmentRepository.updateAttachment(record.id, WORKSPACE_1, {
      syncState: "SYNCED",
      remoteId: "remote-mongo-e",
    });

    // Clear queue so only remote mapping exists
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });

    const count = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    expect(count).toBe(0);
  });

  // Test F — Deleted attachment is not resurrected
  it("P2-F. does not recreate queue records for deleted or tombstoned attachments", async () => {
    const file = new File(["deleted test"], "del.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-f", WORKSPACE_1);

    // Delete attachment atomically (deletes metadata + Blob + creates tombstone)
    await AttachmentService.deleteAttachment(record.id, WORKSPACE_1);

    // Clear queue to simulate lost queue
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });

    const count = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    expect(count).toBe(0);
  });

  // Test G — Workspace isolation
  it("P2-G. respects workspace isolation during recovery passes", async () => {
    const file1 = new File(["ws1 file"], "ws1.txt", { type: "text/plain" });
    const file2 = new File(["ws2 file"], "ws2.txt", { type: "text/plain" });

    const rec1 = await AttachmentService.createAttachment(file1, "note-ws1", WORKSPACE_1);
    const rec2 = await AttachmentService.createAttachment(file2, "note-ws2", WORKSPACE_2);

    // Clear queues
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });

    await AttachmentRepository.updateAttachment(rec1.id, WORKSPACE_1, { syncState: "SYNC_FAILED" });
    await AttachmentRepository.updateAttachment(rec2.id, WORKSPACE_2, { syncState: "SYNC_FAILED" });

    // Recover WORKSPACE_1 only
    const countWs1 = await AttachmentRepository.reconcileMissingQueueEntries(WORKSPACE_1);
    expect(countWs1).toBe(1);

    const opsWs1 = await getPendingOperations(WORKSPACE_1, 50);
    const opsWs2 = await getPendingOperations(WORKSPACE_2, 50);

    expect(opsWs1.some((o) => o.localId === rec1.id)).toBe(true);
    expect(opsWs1.some((o) => o.localId === rec2.id)).toBe(false);
    expect(opsWs2.some((o) => o.localId === rec2.id)).toBe(false);
  });

  // Test H — Normal sync after recovery
  it("P2-H. successfully pushes reconstructed queue records to cloud through normal SyncService pipeline", async () => {
    const file = new File(["full sync test"], "full_sync.txt", { type: "text/plain" });
    const record = await AttachmentService.createAttachment(file, "note-p2-h", WORKSPACE_1);

    // Clear queue to simulate enqueue failure
    const { runTransaction } = await import("./localWorkspaceDatabase");
    await runTransaction("syncQueue", "readwrite", async (tx) => {
      tx.objectStore("syncQueue").clear();
    });
    await AttachmentRepository.updateAttachment(record.id, WORKSPACE_1, { syncState: "SYNC_FAILED" });

    const mockAdapter: any = {
      provider: "mongodb",
      pushOperation: async (rec: any) => ({ remoteId: `mongo-remote-${rec.localId}` }),
      fetchChanges: async () => [],
    };

    const syncService = SyncService.getInstance();
    await syncService.initialize(WORKSPACE_1);
    syncService.registerAdapter(mockAdapter);

    // Perform sync (runs recovery + queue push)
    const result = await syncService.performSync();
    expect(result.success).toBe(true);

    const att = await AttachmentService.getAttachment(record.id, WORKSPACE_1);
    expect(att?.syncState).toBe("SYNCED");
    expect(att?.remoteId).toBe(`mongo-remote-${record.id}`);
  });
});
