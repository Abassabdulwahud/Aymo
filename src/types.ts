export type UploadKind = "image" | "pdf" | "document" | "video" | "audio" | "link";

export type AIProvider = "gemini" | "openai" | "deepseek";

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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
