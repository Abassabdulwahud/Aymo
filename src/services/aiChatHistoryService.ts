import type { ChatMessage } from "../types";
import {
  getLocalAIChatHistory,
  putLocalAIChatHistory,
  deleteLocalAIChatHistory,
} from "./localWorkspaceDatabase";

/**
 * Sanitizes chat messages before persisting to IndexedDB:
 * - Excludes empty "thinking" placeholders so reloaded chats don't display stuck spinners
 * - Normalizes in-flight streaming status to "done" if content is present
 * - Deduplicates by message id while preserving chronological order
 */
export function sanitizeMessagesForPersistence(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const sanitized: ChatMessage[] = [];

  for (const msg of messages) {
    if (!msg || !msg.id) continue;
    // Don't save empty thinking assistant placeholders
    if (msg.role === "assistant" && msg.status === "thinking" && !msg.content?.trim()) {
      continue;
    }
    // Deduplicate by message ID
    if (seen.has(msg.id)) {
      continue;
    }
    seen.add(msg.id);

    // If an assistant message was in-flight (streaming or thinking) but has content,
    // normalize its status to "done" upon persistence so refreshing restores it as a finished message.
    let status = msg.status;
    if (
      msg.role === "assistant" &&
      (status === "streaming" || status === "thinking") &&
      msg.content?.trim()
    ) {
      status = "done";
    }

    sanitized.push({
      ...msg,
      status,
    });
  }

  return sanitized;
}

/**
 * Merges two message lists (e.g. cached server responses and local messages)
 * without duplicate IDs, preserving order.
 */
export function mergeChatMessages(
  primary: ChatMessage[],
  secondary: ChatMessage[],
): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];

  for (const msg of primary) {
    if (msg && msg.id && !seen.has(msg.id)) {
      seen.add(msg.id);
      merged.push(msg);
    }
  }

  for (const msg of secondary) {
    if (msg && msg.id && !seen.has(msg.id)) {
      seen.add(msg.id);
      merged.push(msg);
    }
  }

  return merged;
}

// In-flight serialization map per note to prevent race conditions:
// guarantees newer saves never get overwritten by earlier asynchronous operations.
const saveQueues = new Map<string, Promise<void>>();

/**
 * Saves the conversation for a note into IndexedDB `aiHistory`.
 * Asynchronous writes are serialized per (workspaceId, noteId) to avoid race conditions.
 */
export async function saveAIChatHistory(
  workspaceId: string,
  noteId: string | number,
  messages: ChatMessage[],
): Promise<void> {
  if (!workspaceId || noteId === undefined || noteId === null) return;
  const key = `${workspaceId}:${String(noteId)}`;

  const task = async () => {
    try {
      const sanitized = sanitizeMessagesForPersistence(messages);
      await putLocalAIChatHistory(workspaceId, noteId, sanitized);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[aiChatHistoryService] Failed to save AI history for note ${noteId}:`, err);
      }
    }
  };

  const previousTask = saveQueues.get(key) ?? Promise.resolve();
  const nextTask = previousTask.then(task, task).finally(() => {
    if (saveQueues.get(key) === nextTask) {
      saveQueues.delete(key);
    }
  });

  saveQueues.set(key, nextTask);
  return nextTask;
}

/**
 * Loads the conversation for a note from IndexedDB `aiHistory`.
 * Returns sanitized messages with duplicate IDs removed.
 */
export async function loadAIChatHistory(
  workspaceId: string,
  noteId: string | number,
): Promise<ChatMessage[]> {
  if (!workspaceId || noteId === undefined || noteId === null) return [];
  try {
    const raw = await getLocalAIChatHistory(workspaceId, noteId);
    return sanitizeMessagesForPersistence(raw);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[aiChatHistoryService] Failed to load AI history for note ${noteId}:`, err);
    }
    return [];
  }
}

/**
 * Explicitly clears the conversation for a note in IndexedDB.
 */
export async function clearAIChatHistory(
  workspaceId: string,
  noteId: string | number,
): Promise<void> {
  if (!workspaceId || noteId === undefined || noteId === null) return;
  const key = `${workspaceId}:${String(noteId)}`;
  saveQueues.delete(key);
  try {
    await deleteLocalAIChatHistory(workspaceId, noteId);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[aiChatHistoryService] Failed to clear AI history for note ${noteId}:`, err);
    }
  }
}
