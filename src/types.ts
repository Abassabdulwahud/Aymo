export type UploadKind = "image" | "pdf" | "document" | "video" | "audio" | "link";

export type AIProvider = "gemini" | "openai" | "deepseek" | "anthropic" | "groq" | "cohere";

export interface UploadedItem {
  id: number;
  name: string;
  kind: UploadKind;
  sizeLabel: string;
  source?: string;
  addedAt: string;
  extractionStatus?: string;
  extractionError?: string | null;
  progressPercent?: number;
  detailedSteps?: string | null;
  durationSeconds?: number | null;
  processedChunks?: number;
  totalChunks?: number;
}

export interface InsightItem {
  id: string;
  title: string;
  detail: string;
  type: "key-takeaways" | "questions" | "summary" | "live-summary" | "chat";
}

/**
 * Represents a single message in the AI assistant conversation.
 *
 * status lifecycle:
 *   "thinking"  — bubble visible, AI has not yet returned the first token
 *   "streaming" — first delta arrived, content is growing
 *   "done"      — stream complete, action bar is visible
 *   "error"     — stream failed, error content shown
 *
 * Messages without a status (legacy / loaded from cache before this update)
 * are treated as "done" when content.length > 0.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "thinking" | "streaming" | "done" | "error";
}
