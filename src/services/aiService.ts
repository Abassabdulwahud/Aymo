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
  note_id: number;
  provider: string;
  response: string;
  cached: boolean;
}

interface StreamCallbacks {
  onDelta?: (chunk: string) => void;
}

export async function listAIResponses(token: string, noteId: number): Promise<CachedAIResponse[]> {
  const response = await apiRequest<CachedAIResponseList>(`/api/protected/ai/response/${noteId}`, {
    method: "GET",
    token,
  });
  return response.items;
}

export async function chatWithAIHttp(
  token: string,
  noteId: number,
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
  noteId: number,
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
    const timeoutId = window.setTimeout(() => {
      fail(new Error("The AI assistant connection timed out."));
    }, 8000);

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
      reject(error);
    };

    socket.addEventListener("open", () => {
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
          const chunk = payload.content ?? "";
          finalContent += chunk;
          callbacks.onDelta?.(chunk);
          return;
        }

        if (!settled) {
          settled = true;
          window.clearTimeout(timeoutId);
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
