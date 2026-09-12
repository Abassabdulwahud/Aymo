import { AIProvider } from "../types";
import { apiRequest, getApiBaseUrl } from "./apiClient";

export interface CachedAIResponse {
  id: string;
  provider: string;
  question: string;
  response: string;
  created_at: string;
}

interface CachedAIResponseList {
  items: CachedAIResponse[];
  total: number;
}

interface ChatResponse {
  note_id: string | number;
  provider: string;
  response: string;
  cached: boolean;
}

interface StreamCallbacks {
  onDelta?: (chunk: string) => void;
}

export async function listAIResponses(token: string, noteId: string | number): Promise<CachedAIResponse[]> {
  const response = await apiRequest<CachedAIResponseList>(`/api/protected/ai/response/${noteId}`, {
    method: "GET",
    token,
  });
  return response.items;
}

export async function chatWithAIHttp(
  token: string,
  noteId: string | number,
  message: string,
  aiProvider: AIProvider,
): Promise<ChatResponse> {
  return apiRequest<ChatResponse>("/api/protected/ai/chat", {
    method: "POST",
    token,
    body: { note_id: noteId, message, ai_provider: aiProvider },
  });
}

function resolveWebSocketBase(): string {
  const apiBase = getApiBaseUrl();
  const baseUrl = new URL(apiBase);
  const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${baseUrl.host}`;
}

export async function streamAIChat(
  token: string,
  noteId: string | number,
  message: string,
  aiProvider: AIProvider,
  callbacks: StreamCallbacks = {},
): Promise<{ provider: string; content: string; cached: boolean }> {
  const wsUrl = `${resolveWebSocketBase()}/ws/ai/chat/${noteId}?token=${encodeURIComponent(token)}`;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let finalContent = "";
    let provider = "assistant";
    let settled = false;

    let timerId: number | null = window.setTimeout(() => {
      fail(new Error("The AI assistant connection timed out."));
    }, 15000);

    const resetTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        fail(new Error("The AI assistant connection timed out."));
      }, 15000);
    };

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimer();
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
      reject(error);
    };

    socket.addEventListener("open", () => {
      resetTimer();
      socket.send(JSON.stringify({ message, ai_provider: aiProvider }));
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: "delta" | "complete" | "error";
          provider?: string;
          content?: string;
          detail?: string;
          cached?: boolean;
        };

        if (payload.type === "error") {
          fail(new Error(payload.detail || "The AI assistant could not respond."));
          return;
        }

        if (payload.provider) {
          provider = payload.provider;
        }

        if (payload.type === "delta") {
          resetTimer();
          const chunk = payload.content ?? "";
          finalContent += chunk;
          callbacks.onDelta?.(chunk);
          return;
        }

        if (!settled) {
          settled = true;
          clearTimer();
          const completedContent = payload.cached ? payload.content ?? finalContent : finalContent || payload.content || "";
          socket.close();
          resolve({
            provider,
            content: completedContent,
            cached: Boolean(payload.cached),
          });
        }
      } catch {
        fail(new Error("The AI assistant returned an unreadable response."));
      }
    });

    socket.addEventListener("error", () => {
      fail(new Error("Real-time AI chat is unavailable right now."));
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        fail(new Error("The AI assistant connection closed unexpectedly."));
      }
    });
  });
}

