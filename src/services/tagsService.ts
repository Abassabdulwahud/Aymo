import { apiRequest } from "./apiClient";

export interface BackendTagWithCount {
  id: number;
  user_id: number;
  name: string;
  note_count: number;
}

interface TagListResponse {
  items: BackendTagWithCount[];
  total: number;
}

export async function listTags(token: string): Promise<BackendTagWithCount[]> {
  const response = await apiRequest<TagListResponse>("/api/protected/tags", {
    method: "GET",
    token,
  });
  return response.items;
}
