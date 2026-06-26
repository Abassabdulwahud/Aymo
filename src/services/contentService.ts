import { apiRequest } from "./apiClient";

interface FileJobResponse {
  file_id: number;
  task_id: string;
  status: string;
  message: string;
}

export async function syncNoteContent(
  token: string,
  noteId: number,
  payload: { title?: string; body: string },
): Promise<void> {
  await apiRequest(`/api/protected/content/sync`, {
    method: "POST",
    token,
    body: {
      note_id: noteId,
      title: payload.title,
      body: payload.body,
    },
  });
}

export async function queuePdfExtraction(token: string, fileId: number): Promise<FileJobResponse> {
  return apiRequest<FileJobResponse>("/api/protected/files/extract-pdf", {
    method: "POST",
    token,
    body: { file_id: fileId },
  });
}

export async function queueMediaTranscription(
  token: string,
  fileId: number,
  payload?: { duration_seconds?: number; transcript_text?: string },
): Promise<FileJobResponse> {
  return apiRequest<FileJobResponse>("/api/protected/files/transcribe-audio", {
    method: "POST",
    token,
    body: {
      file_id: fileId,
      duration_seconds: payload?.duration_seconds,
      transcript_text: payload?.transcript_text,
    },
  });
}

export async function queueLinkScrape(token: string, fileId: number): Promise<FileJobResponse> {
  return apiRequest<FileJobResponse>("/api/protected/files/scrape-link", {
    method: "POST",
    token,
    body: { file_id: fileId },
  });
}
