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


export async function queueLinkScrape(token: string, fileId: number): Promise<FileJobResponse> {
  return apiRequest<FileJobResponse>("/api/protected/files/scrape-link", {
    method: "POST",
    token,
    body: { file_id: fileId },
  });
}
