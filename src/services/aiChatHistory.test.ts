import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  saveAIChatHistory,
  loadAIChatHistory,
  clearAIChatHistory,
  mergeChatMessages,
  sanitizeMessagesForPersistence,
} from "./aiChatHistoryService";
import {
  getLocalAIChatHistory,
  putLocalAIChatHistory,
} from "./localWorkspaceDatabase";
import type { ChatMessage } from "../types";

const WORKSPACE_1 = "ws-test-workspace-1";
const WORKSPACE_2 = "ws-test-workspace-2";
const NOTE_A = "note-id-101";
const NOTE_B = "note-id-102";

describe("AI Conversation History Persistence Across Refresh", () => {
  beforeEach(async () => {
    // Reset IndexedDB database before each test
    const req = indexedDB.deleteDatabase("aymo_local");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  // =========================================================================
  // Test A — Save and restore
  // =========================================================================
  it("Test A: saves user message and AI response, and restores them in the correct order", async () => {
    const userMsg: ChatMessage = {
      id: "user-msg-1",
      role: "user",
      content: "Explain quantum computing briefly.",
    };
    const assistantMsg: ChatMessage = {
      id: "assistant-msg-1",
      role: "assistant",
      content: "Quantum computing uses qubits that exploit superposition and entanglement.",
      status: "done",
    };

    // Save initial user message and completed response
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, [userMsg, assistantMsg]);

    // Simulate re-initializing or reading via persistence layer
    const restored = await loadAIChatHistory(WORKSPACE_1, NOTE_A);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual({
      id: "user-msg-1",
      role: "user",
      content: "Explain quantum computing briefly.",
      status: undefined,
    });
    expect(restored[1]).toEqual({
      id: "assistant-msg-1",
      role: "assistant",
      content: "Quantum computing uses qubits that exploit superposition and entanglement.",
      status: "done",
    });
    // Verify order
    expect(restored[0].role).toBe("user");
    expect(restored[1].role).toBe("assistant");
  });

  // =========================================================================
  // Test B — Refresh persistence
  // =========================================================================
  it("Test B: restores conversation from persistence layer after in-memory state is recreated (simulating browser refresh)", async () => {
    // Stage 1: Active in-memory session
    let memoryState: ChatMessage[] = [
      {
        id: "u-1",
        role: "user",
        content: "What are the main causes of climate change?",
      },
      {
        id: "a-1",
        role: "assistant",
        content: "Greenhouse gas emissions from burning fossil fuels, deforestation, and industrial processes.",
        status: "done",
      },
    ];

    await saveAIChatHistory(WORKSPACE_1, NOTE_A, memoryState);

    // Stage 2: Browser refresh simulation — wipe memory state completely
    memoryState = [];
    expect(memoryState).toHaveLength(0);

    // Stage 3: New component mount / refresh hydration loads directly from IndexedDB
    const rehydrated = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(rehydrated).toHaveLength(2);
    expect(rehydrated[0].id).toBe("u-1");
    expect(rehydrated[0].content).toBe("What are the main causes of climate change?");
    expect(rehydrated[1].id).toBe("a-1");
    expect(rehydrated[1].content).toContain("Greenhouse gas emissions");
    expect(rehydrated[1].status).toBe("done");
  });

  // =========================================================================
  // Test C — Continue conversation
  // =========================================================================
  it("Test C: appends new messages to a restored conversation without losing previous messages", async () => {
    // 1. Initial turn
    const turn1: ChatMessage[] = [
      { id: "u-1", role: "user", content: "Tell me a joke." },
      { id: "a-1", role: "assistant", content: "Why don't scientists trust atoms? Because they make up everything!", status: "done" },
    ];
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, turn1);

    // 2. Restore after reload
    const restoredTurn1 = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(restoredTurn1).toHaveLength(2);

    // 3. User continues conversation
    const turn2User: ChatMessage = {
      id: "u-2",
      role: "user",
      content: "Explain why that is funny.",
    };
    const turn2Assistant: ChatMessage = {
      id: "a-2",
      role: "assistant",
      content: "It is a pun on 'make up everything' referring to physical composition and fabricating stories.",
      status: "done",
    };

    const combinedTurn = [...restoredTurn1, turn2User, turn2Assistant];
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, combinedTurn);

    // 4. Verify full conversation history across another reload
    const finalHistory = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(finalHistory).toHaveLength(4);
    expect(finalHistory[0].id).toBe("u-1");
    expect(finalHistory[1].id).toBe("a-1");
    expect(finalHistory[2].id).toBe("u-2");
    expect(finalHistory[3].id).toBe("a-2");
    expect(finalHistory.map((m) => m.id)).toEqual(["u-1", "a-1", "u-2", "a-2"]);
  });

  // =========================================================================
  // Test D — Isolation
  // =========================================================================
  it("Test D1: note-level isolation ensures restoring Note A never returns Note B messages", async () => {
    const noteAMessages: ChatMessage[] = [
      { id: "note-a-u1", role: "user", content: "Notes on Chemistry" },
      { id: "note-a-a1", role: "assistant", content: "Chemistry deals with properties of substances.", status: "done" },
    ];
    const noteBMessages: ChatMessage[] = [
      { id: "note-b-u1", role: "user", content: "Notes on Biology" },
      { id: "note-b-a1", role: "assistant", content: "Biology is the study of living organisms.", status: "done" },
    ];

    await saveAIChatHistory(WORKSPACE_1, NOTE_A, noteAMessages);
    await saveAIChatHistory(WORKSPACE_1, NOTE_B, noteBMessages);

    const restoredA = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    const restoredB = await loadAIChatHistory(WORKSPACE_1, NOTE_B);

    expect(restoredA).toHaveLength(2);
    expect(restoredA[0].content).toBe("Notes on Chemistry");
    expect(restoredA.some((m) => m.content.includes("Biology"))).toBe(false);

    expect(restoredB).toHaveLength(2);
    expect(restoredB[0].content).toBe("Notes on Biology");
    expect(restoredB.some((m) => m.content.includes("Chemistry"))).toBe(false);
  });

  it("Test D2: workspace-level isolation ensures restoring Workspace 1 never leaks to Workspace 2", async () => {
    const ws1Messages: ChatMessage[] = [
      { id: "ws1-msg", role: "user", content: "Secret project in Workspace 1" },
    ];
    const ws2Messages: ChatMessage[] = [
      { id: "ws2-msg", role: "user", content: "Public project in Workspace 2" },
    ];

    await saveAIChatHistory(WORKSPACE_1, NOTE_A, ws1Messages);
    await saveAIChatHistory(WORKSPACE_2, NOTE_A, ws2Messages);

    const restoredWs1 = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    const restoredWs2 = await loadAIChatHistory(WORKSPACE_2, NOTE_A);

    expect(restoredWs1).toHaveLength(1);
    expect(restoredWs1[0].id).toBe("ws1-msg");
    expect(restoredWs1[0].content).toBe("Secret project in Workspace 1");

    expect(restoredWs2).toHaveLength(1);
    expect(restoredWs2[0].id).toBe("ws2-msg");
    expect(restoredWs2[0].content).toBe("Public project in Workspace 2");
  });

  // =========================================================================
  // Test E — No duplicates
  // =========================================================================
  it("Test E: multiple saves or restores do not introduce duplicate messages", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-101", role: "user", content: "First prompt" },
      { id: "msg-102", role: "assistant", content: "First answer", status: "done" },
    ];

    // Save multiple times (e.g. repeated autosaves or duplicate user calls)
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, messages);
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, [...messages, messages[1]]);
    await saveAIChatHistory(WORKSPACE_1, NOTE_A, messages);

    const restored = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(restored).toHaveLength(2);
    expect(restored.map((m) => m.id)).toEqual(["msg-101", "msg-102"]);

    // Test merging server cache + local messages without duplicating
    const remoteCache: ChatMessage[] = [
      { id: "msg-101", role: "user", content: "First prompt" },
      { id: "msg-102", role: "assistant", content: "First answer", status: "done" },
    ];
    const localExtra: ChatMessage[] = [
      { id: "msg-102", role: "assistant", content: "First answer", status: "done" },
      { id: "msg-103", role: "user", content: "Second prompt" },
    ];
    const merged = mergeChatMessages(remoteCache, localExtra);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.id)).toEqual(["msg-101", "msg-102", "msg-103"]);
  });

  // =========================================================================
  // Test F — Explicit clearing vs Refresh
  // =========================================================================
  it("Test F: refreshing never clears history, but explicit clearing (clearAIChatHistory) removes it", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-keep-1", role: "user", content: "Important conversation" },
      { id: "msg-keep-2", role: "assistant", content: "Important response", status: "done" },
    ];

    await saveAIChatHistory(WORKSPACE_1, NOTE_A, messages);

    // Refresh simulation: reloading multiple times keeps data intact
    const reload1 = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(reload1).toHaveLength(2);
    const reload2 = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(reload2).toHaveLength(2);

    // Explicit clearing (e.g. when note is deleted or conversation cleared)
    await clearAIChatHistory(WORKSPACE_1, NOTE_A);

    const afterClear = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(afterClear).toHaveLength(0);

    // Ensure Note B in the same workspace is not affected by clearing Note A
    await saveAIChatHistory(WORKSPACE_1, NOTE_B, messages);
    await clearAIChatHistory(WORKSPACE_1, NOTE_A);
    const noteBHistory = await loadAIChatHistory(WORKSPACE_1, NOTE_B);
    expect(noteBHistory).toHaveLength(2);
  });

  // =========================================================================
  // Additional Edge Cases: Streaming response & queue serialization
  // =========================================================================
  it("sanitizes empty thinking placeholders and marks in-flight streaming responses as done on restore", async () => {
    const unfinalizedMessages: ChatMessage[] = [
      { id: "u-stream", role: "user", content: "Streaming test" },
      { id: "a-thinking-empty", role: "assistant", content: "", status: "thinking" },
      { id: "a-streaming", role: "assistant", content: "Partial streamed answer", status: "streaming" },
    ];

    const sanitized = sanitizeMessagesForPersistence(unfinalizedMessages);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0].id).toBe("u-stream");
    // Empty thinking placeholder excluded
    expect(sanitized.some((m) => m.id === "a-thinking-empty")).toBe(false);
    // In-flight streaming message with content normalized to "done"
    expect(sanitized[1].id).toBe("a-streaming");
    expect(sanitized[1].status).toBe("done");
  });

  it("prevents async save race conditions by serializing saves in FIFO order", async () => {
    const msg1: ChatMessage = { id: "m-1", role: "user", content: "Step 1" };
    const msg2: ChatMessage = { id: "m-2", role: "user", content: "Step 2" };
    const msg3: ChatMessage = { id: "m-3", role: "user", content: "Step 3" };

    // Fire 3 saves concurrently without awaiting between them
    const p1 = saveAIChatHistory(WORKSPACE_1, NOTE_A, [msg1]);
    const p2 = saveAIChatHistory(WORKSPACE_1, NOTE_A, [msg1, msg2]);
    const p3 = saveAIChatHistory(WORKSPACE_1, NOTE_A, [msg1, msg2, msg3]);

    await Promise.all([p1, p2, p3]);

    const result = await loadAIChatHistory(WORKSPACE_1, NOTE_A);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
  });
});
