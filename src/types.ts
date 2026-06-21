export type UploadKind = "pdf" | "doc" | "video" | "audio" | "link";

export type AIProvider = "gemini" | "openai" | "deepseek";

export interface UploadedItem {
  id: string;
  name: string;
  kind: UploadKind;
  sizeLabel: string;
  source?: string;
  addedAt: string;
}

export interface InsightItem {
  id: string;
  title: string;
  detail: string;
}
