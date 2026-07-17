import { apiRequest } from "./apiClient";
import type { Annotation, AnnotationSourceType, AnnotationType, BoundingRect } from "../types";

export interface AnnotationCreatePayload {
  source_type: AnnotationSourceType;
  source_id: number;
  page_number?: number | null;
  selected_text: string;
  bounding_rects?: BoundingRect[] | null;
  start_offset?: number | null;
  end_offset?: number | null;
  color?: string;
  annotation_type?: AnnotationType;
  comment?: string | null;
  linked_note_id?: number | null;
}

export interface AnnotationUpdatePayload {
  color?: string;
  annotation_type?: AnnotationType;
  comment?: string | null;
  linked_note_id?: number | null;
}

interface AnnotationListResponse {
  items: Annotation[];
  total: number;
}

export async function listAnnotations(
  token: string,
  sourceType: AnnotationSourceType,
  sourceId: number,
  pageNumber?: number,
): Promise<Annotation[]> {
  let path = `/api/protected/annotations?source_type=${encodeURIComponent(sourceType)}&source_id=${sourceId}`;
  if (pageNumber !== undefined) {
    path += `&page_number=${pageNumber}`;
  }
  const response = await apiRequest<AnnotationListResponse>(path, {
    method: "GET",
    token,
  });
  return response.items;
}

export async function createAnnotation(
  token: string,
  payload: AnnotationCreatePayload,
): Promise<Annotation> {
  return apiRequest<Annotation>("/api/protected/annotations", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function updateAnnotation(
  token: string,
  annotationId: number,
  payload: AnnotationUpdatePayload,
): Promise<Annotation> {
  return apiRequest<Annotation>(`/api/protected/annotations/${annotationId}`, {
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function deleteAnnotation(
  token: string,
  annotationId: number,
): Promise<void> {
  await apiRequest<void>(`/api/protected/annotations/${annotationId}`, {
    method: "DELETE",
    token,
  });
}
