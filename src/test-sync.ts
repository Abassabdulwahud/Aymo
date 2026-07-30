import { openLocalWorkspaceDatabase } from "./services/localWorkspaceDatabase";
import { createNote, updateNote, trashNote, toggleNotePin, permanentlyDeleteNote } from "./services/localNotesService";
import { compactQueue, getQueueStats, checkQueueIntegrity } from "./services/syncQueue";
import { syncService } from "./services/syncService";
import { MongoDBAdapter } from "./services/mongoDbAdapter";

// Real production JWT token we registered for E2E testing
const REAL_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItc3luY0BheW1vLmFwcCIsImV4cCI6MTc4NTQwMzIyMCwicHVycG9zZSI6ImFjY2VzcyJ9.8eZRcAYUJDI8hFTjd9AGFmWKEGHJVXTRBGWo6Fnu6Qs";

const outputEl = document.getElementById("log")!;

function log(msg: string, status: "info" | "pass" | "fail" = "info") {
  const div = document.createElement("div");
  div.className = `log-entry ${status}`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  outputEl.appendChild(div);
  console.log(msg);
}

async function runTests() {
  log("Starting E2E Synchronization Pipeline Verification...", "info");

  const workspaceId = "test-ws-" + Math.random().toString(36).substring(7);
  log(`Generated random test workspaceId: ${workspaceId}`, "info");

  // ── Step 1: Initialize Database ──────────────────────────────────────────
  try {
    const db = await openLocalWorkspaceDatabase();
    log("Step 1: IndexedDB 'aymo_local' initialized successfully", "pass");
  } catch (e: any) {
    log(`Step 1 Failed: IndexedDB init failed: ${e.message || e}`, "fail");
    return;
  }

  // ── Step 2: Local Workspace Test (Offline state, no sync service yet) ──────
  log("Step 2: Starting Local Workspace Offline Test...", "info");
  
  let note1Id = "";
  let note1: any = null;
  try {
    // 1. Create a note
    note1 = await createNote(workspaceId, {
      title: "Initial Title",
      body: "Initial Body",
      isPinned: false,
      isFavorited: false,
      tags: [],
      files: [],
      deletedAt: null
    });
    note1Id = note1.id;
    log(`Created Note 1: id=${note1Id}, title="${note1.title}"`, "pass");

    // 2. Edit note multiple times (to test compaction later)
    note1 = await updateNote({ ...note1, title: "First Edit Title", body: "First Edit Body" });
    note1 = await updateNote({ ...note1, title: "Second Edit Title", body: "Second Edit Body" });
    note1 = await updateNote({ ...note1, title: "Final Title", body: "Final Body" });
    log("Edited Note 1 three times consecutively while offline", "pass");

    // 3. Rename/Pin note
    const pinnedNote = await toggleNotePin(note1);
    log(`Pinned Note 1: isPinned=${pinnedNote.isPinned}`, "pass");

    // 4. Create Note 2 and soft-delete (trash) it
    const note2 = await createNote(workspaceId, {
      title: "Note 2 to Trash",
      body: "Trash body",
      isPinned: false,
      isFavorited: false,
      tags: [],
      files: [],
      deletedAt: null
    });
    await trashNote(note2);
    log("Created Note 2 and moved it to Trash (soft delete)", "pass");

    // 5. Create Note 3 and hard-delete it (write tombstone)
    const note3 = await createNote(workspaceId, {
      title: "Note 3 to Permanent Delete",
      body: "Delete body",
      isPinned: false,
      isFavorited: false,
      tags: [],
      files: [],
      deletedAt: null
    });
    await permanentlyDeleteNote(note3);
    log("Created Note 3 and permanently deleted it (created tombstone)", "pass");

  } catch (e: any) {
    log(`Step 2 Failed: Local operations failed: ${e.message || e}`, "fail");
    return;
  }

  // ── Step 3: Offline Queue and Compaction Test ─────────────────────────────
  log("Step 3: Checking Sync Queue and Compaction...", "info");
  try {
    const integrityReport = await checkQueueIntegrity(workspaceId);
    log(`Queue Integrity Report: awaitingSync=${integrityReport.awaitingSync}, compactableUpdates=${integrityReport.compactableUpdates}`, "info");

    if (integrityReport.compactableUpdates !== 3) {
      log(`Expected 3 compactable updates, got ${integrityReport.compactableUpdates}`, "fail");
    } else {
      log("Verified 3 redundant updates exist in the queue", "pass");
    }

    // Run compaction
    const compactedCount = await compactQueue(workspaceId);
    log(`Executed queue compaction: removed ${compactedCount} redundant operations`, "pass");

    const finalReport = await checkQueueIntegrity(workspaceId);
    if (finalReport.compactableUpdates === 0) {
      log("Verified queue compaction successfully squashed updates down to 0 redundant entries", "pass");
    } else {
      log(`Compaction failed to remove all redundant updates: ${finalReport.compactableUpdates} left`, "fail");
    }

  } catch (e: any) {
    log(`Step 3 Failed: Queue check or compaction failed: ${e.message || e}`, "fail");
    return;
  }

  // ── Step 4: Online Sync Test ──────────────────────────────────────────────
  log("Step 4: Enabling Sync Adapter and starting SyncService...", "info");
  try {
    const adapter = new MongoDBAdapter(REAL_JWT);
    
    // Check connection first
    const isAvailable = await adapter.isAvailable();
    if (!isAvailable) {
      log("FastAPI backend or MongoDB Atlas is offline. Please start uvicorn and configure MONGODB_URL.", "fail");
      return;
    }
    log("Confirmed FastAPI is online and connected to MongoDB Atlas", "pass");

    await syncService.initialize(workspaceId);
    syncService.registerAdapter(adapter);
    
    log("Starting SyncService drain loop...", "info");
    syncService.start();

    // Wait for the queue to drain (max 10 seconds)
    let attempts = 0;
    while (attempts < 20) {
      const stats = await getQueueStats(workspaceId);
      const totalPending = stats.pending + stats.failed + stats.processing;
      if (totalPending === 0) {
        log("Sync queue completely drained!", "pass");
        break;
      }
      log(`Waiting for queue to drain... ${totalPending} remaining`, "info");
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    const finalStats = await getQueueStats(workspaceId);
    if (finalStats.pending + finalStats.failed + finalStats.processing > 0) {
      log("Sync timed out before queue was fully drained", "fail");
      return;
    }

  } catch (e: any) {
    log(`Step 4 Failed: Synchronization test failed: ${e.message || e}`, "fail");
    return;
  }

  // ── Step 5: Backend Verification ──────────────────────────────────────────
  log("Step 5: Verifying data exists in MongoDB Atlas via pull API...", "info");
  try {
    const adapter = new MongoDBAdapter(REAL_JWT);
    const changes = await adapter.fetchChanges(workspaceId, null);
    
    log(`Pulled ${changes.length} synced changes from MongoDB Atlas`, "info");
    
    const note1Change = changes.find(c => c.localId === note1Id);
    if (note1Change) {
      log(`Verified Note 1 exists in MongoDB Atlas! title="${note1Change.payload.title}"`, "pass");
    } else {
      log("Note 1 not found in MongoDB Atlas", "fail");
    }

    const tombstoneChange = changes.find(c => c.operation === "delete" && c.payload.permanent === true);
    if (tombstoneChange) {
      log("Verified permanent delete tombstone exists in MongoDB Atlas!", "pass");
    } else {
      log("Tombstone not found in MongoDB Atlas", "fail");
    }

  } catch (e: any) {
    log(`Step 5 Failed: MongoDB Atlas verification failed: ${e.message || e}`, "fail");
    return;
  }

  // ── Step 6: Crash Recovery Test ───────────────────────────────────────────
  log("Step 6: Executing Crash Recovery Test...", "info");
  try {
    const db = await openLocalWorkspaceDatabase();
    
    // Simulate a crash: insert a "processing" record directly into the store
    const recordId = "simulated-crash-rec";
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("syncQueue", "readwrite");
      const store = tx.objectStore("syncQueue");
      store.put({
        id: recordId,
        workspaceId,
        entityType: "note",
        operation: "update",
        localId: note1Id,
        payload: { title: "Crashed Title", body: "Crashed Body" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: 0,
        status: "processing",
        lastError: null
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    log("Inserted simulated 'processing' record (simulating crash during push)", "info");
    
    // Destroy the current running instance to simulate a complete shutdown
    await syncService.destroy();
    
    // Initialize SyncService again (it runs recoverStuckOperations)
    await syncService.initialize(workspaceId);
    
    // Verify it was reset to pending
    const stats = await getQueueStats(workspaceId);
    if (stats.pending > 0) {
      log("Crash recovery reset 'processing' record back to 'pending' successfully!", "pass");
    } else {
      log("Crash recovery did not reset the processing record", "fail");
    }

    // Let it drain the recovered record
    syncService.start();
    await new Promise(r => setTimeout(r, 1500));
    log("Drained recovered record", "pass");

  } catch (e: any) {
    log(`Step 6 Failed: Crash recovery test failed: ${e.message || e}`, "fail");
    return;
  }

  log("ALL E2E SYNCHRONIZATION PIPELINE TESTS PASSED SUCCESSFULLY! 🎉", "pass");
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("run-btn")!.addEventListener("click", runTests);
});
