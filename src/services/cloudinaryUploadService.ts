import { apiRequest } from "./apiClient";
import { loadAuthToken } from "./authService";

export interface CloudinaryAuthResponse {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  publicId: string;
  folder: string;
  resourceType: "image" | "video" | "raw";
  signature: string;
  uploadUrl: string;
}

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  bytes?: number;
  format?: string;
  resourceType: string;
}

export interface CloudinaryDeleteResponse {
  status: string;
  attachmentId: string;
  cloudinaryPublicId: string;
}

/**
 * Requests scoped Cloudinary signed authorization parameters from the Render backend.
 * Enforces JWT authentication, workspace access, and server-side MIME / size policies.
 */
export async function requestCloudinaryUploadAuth(
  workspaceId: string,
  attachmentId: string,
  mimeType: string,
  sizeBytes: number,
  token?: string | null,
): Promise<CloudinaryAuthResponse> {
  const authToken = token || loadAuthToken();
  if (!authToken) {
    throw new Error("Authentication required to request Cloudinary upload authorization.");
  }

  return apiRequest<CloudinaryAuthResponse>("/api/protected/sync/cloudinary-auth", {
    method: "POST",
    token: authToken,
    body: {
      workspaceId,
      attachmentId,
      mimeType,
      sizeBytes,
    },
  });
}

/**
 * Uploads an attachment binary Blob directly from the browser to the Cloudinary CDN.
 * The Render backend is NEVER used as a proxy for binary data.
 */
export async function uploadBlobToCloudinary(
  blob: Blob,
  auth: CloudinaryAuthResponse,
): Promise<CloudinaryUploadResult> {
  const formData = new FormData();
  formData.append("file", blob);
  formData.append("api_key", auth.apiKey);
  formData.append("timestamp", String(auth.timestamp));
  formData.append("signature", auth.signature);
  formData.append("folder", auth.folder);
  formData.append("public_id", auth.publicId);
  formData.append("overwrite", "true");
  formData.append("unique_filename", "false");

  const response = await fetch(auth.uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary direct upload failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    public_id?: string;
    secure_url?: string;
    url?: string;
    bytes?: number;
    format?: string;
    resource_type?: string;
  };

  const secureUrl = data.secure_url || data.url;
  const publicId = data.public_id || auth.publicId;

  if (!secureUrl) {
    throw new Error("Cloudinary direct upload succeeded but returned no secure_url.");
  }

  return {
    publicId,
    secureUrl,
    bytes: data.bytes,
    format: data.format,
    resourceType: data.resource_type || auth.resourceType,
  };
}

/**
 * Requests authorized deletion of an attachment asset from Cloudinary and MongoDB.
 * The backend server strictly derives target public_id from workspaceId and attachmentId.
 */
export async function requestCloudinaryDeletion(
  workspaceId: string,
  attachmentId: string,
  token?: string | null,
): Promise<CloudinaryDeleteResponse> {
  const authToken = token || loadAuthToken();
  if (!authToken) {
    throw new Error("Authentication required to request Cloudinary deletion.");
  }

  return apiRequest<CloudinaryDeleteResponse>("/api/protected/sync/cloudinary-delete", {
    method: "POST",
    token: authToken,
    body: {
      workspaceId,
      attachmentId,
    },
  });
}
