import { apiRequest, resolveApiAssetUrl } from "./apiClient";

export interface BackendTag {
  id: number;
  name: string;
}

export interface BackendFile {
  id: number;
  note_id: number;
  user_id: number;
  file_name: string;
  file_type: "image" | "pdf" | "document" | "video" | "audio" | "link";
  file_url: string;
  file_size: number;
  extraction_status?: string;
  extraction_error?: string | null;
  progress_percent?: number;
  detailed_steps?: string | null;
  duration_seconds?: number | null;
  processed_chunks?: number;
  total_chunks?: number;
  uploaded_at: string;
}

export interface BackendNote {
  id: number;
  user_id: number;
  title: string;
  body: string;
  is_pinned: boolean;
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  tags: BackendTag[];
  files: BackendFile[];
}

interface NoteListResponse {
  items: BackendNote[];
  total: number;
}

interface FileListResponse {
  items: BackendFile[];
  total: number;
}

function normalizeBackendFile(file: BackendFile): BackendFile {
  return {
    ...file,
    file_url: resolveApiAssetUrl(file.file_url) ?? file.file_url,
  };
}

function normalizeBackendNote(note: BackendNote): BackendNote {
  return {
    ...note,
    files: note.files.map(normalizeBackendFile),
  };
}

export async function listNotes(token: string): Promise<BackendNote[]> {
  const response = await apiRequest<NoteListResponse>("/api/protected/notes", {
    method: "GET",
    token,
  });
  return response.items.map(normalizeBackendNote);
}

export async function listTrashedNotes(token: string, search?: string): Promise<BackendNote[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await apiRequest<NoteListResponse>(`/api/protected/notes/trash${query}`, {
    method: "GET",
    token,
  });
  return response.items.map(normalizeBackendNote);
}

export async function restoreNote(token: string, noteId: number): Promise<BackendNote> {
  const note = await apiRequest<BackendNote>(`/api/protected/notes/trash/${noteId}/restore`, {
    method: "POST",
    token,
  });
  return normalizeBackendNote(note);
}

export async function permanentlyDeleteNote(token: string, noteId: number): Promise<void> {
  await apiRequest<void>(`/api/protected/notes/trash/${noteId}`, {
    method: "DELETE",
    token,
  });
}

export async function emptyTrash(token: string): Promise<void> {
  await apiRequest<void>("/api/protected/notes/trash", {
    method: "DELETE",
    token,
  });
}

export async function getNoteFiles(token: string, noteId: number): Promise<BackendFile[]> {
  const response = await apiRequest<FileListResponse>(`/api/protected/notes/${noteId}/files`, {
    method: "GET",
    token,
  });
  return response.items.map(normalizeBackendFile);
}

export async function createNote(token: string): Promise<BackendNote> {
  const note = await apiRequest<BackendNote>("/api/protected/notes", {
    method: "POST",
    token,
    body: {
      title: "",
      body: "",
      tag_ids: [],
      is_pinned: false,
      is_favorited: false,
    },
  });
  return normalizeBackendNote(note);
}

export async function updateNote(
  token: string,
  noteId: number,
  patch: {
    title?: string;
    body?: string;
    is_pinned?: boolean;
    is_favorited?: boolean;
    tag_ids?: number[];
  },
): Promise<BackendNote> {
  const note = await apiRequest<BackendNote>(`/api/protected/notes/${noteId}`, {
    method: "PATCH",
    token,
    body: patch,
  });
  return normalizeBackendNote(note);
}

export async function setNotePin(token: string, noteId: number, value: boolean): Promise<BackendNote> {
  const note = await apiRequest<BackendNote>(`/api/protected/notes/${noteId}/pin`, {
    method: "POST",
    token,
    body: { value },
  });
  return normalizeBackendNote(note);
}

export async function deleteNote(token: string, noteId: number): Promise<void> {
  await apiRequest<void>(`/api/protected/notes/${noteId}`, {
    method: "DELETE",
    token,
  });
}

export async function uploadFile(token: string, noteId: number, file: File): Promise<BackendFile> {
  const formData = new FormData();
  formData.append("upload", file);

  const uploaded = await apiRequest<BackendFile>(`/api/protected/notes/${noteId}/files`, {
    method: "POST",
    token,
    body: formData,
  });
  return normalizeBackendFile(uploaded);
}

export async function addLink(token: string, noteId: number, url: string, title?: string): Promise<BackendFile> {
  const link = await apiRequest<BackendFile>(`/api/protected/notes/${noteId}/links`, {
    method: "POST",
    token,
    body: { url, title },
  });
  return normalizeBackendFile(link);
}

export async function removeFile(token: string, fileId: number): Promise<void> {
  await apiRequest<void>(`/api/protected/files/${fileId}`, {
    method: "DELETE",
    token,
  });
}
