function resolveApiBaseUrl(): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const { protocol, hostname, port } = window.location;
  const isLocalDevFrontend = ["127.0.0.1", "localhost"].includes(hostname) && ["5173", "5174", "5175"].includes(port);
  if (isLocalDevFrontend) {
    return `${protocol}//127.0.0.1:8000`;
  }

  return window.location.origin.trim().replace(/\/+$/, "");
}

const API_BASE_URL = resolveApiBaseUrl();

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

/**
 * Typed error thrown by apiRequest.
 *
 * `status` is the HTTP status code when the server responded (e.g. 401, 500).
 * `status` is `null` when the request never reached the server (network error,
 * connection refused, timeout, etc.).
 *
 * Callers that need to distinguish authentication failures from transient
 * outages should check `status === 401` rather than parsing the message string.
 */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  token?: string | null;
  body?: BodyInit | object | null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, body, headers, ...init } = options;
  const resolvedHeaders = new Headers(headers);

  if (token) {
    resolvedHeaders.set("Authorization", `Bearer ${token}`);
  }

  let resolvedBody: BodyInit | undefined;
  if (body instanceof FormData) {
    resolvedBody = body;
  } else if (body != null) {
    resolvedHeaders.set("Content-Type", "application/json");
    resolvedBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: resolvedHeaders,
      body: resolvedBody,
    });
  } catch (networkError) {
    // The request never reached the server (connection refused, DNS failure,
    // timeout, CORS preflight blocked, etc.).
    const message = networkError instanceof Error ? networkError.message : "Network error.";
    throw new ApiError(message, null);
  }

  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Ignore JSON parsing errors for empty responses.
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function resolveApiAssetUrl(pathOrUrl: string | undefined | null): string | undefined {
  if (!pathOrUrl) return undefined;

  try {
    return new URL(pathOrUrl, `${API_BASE_URL}/`).toString();
  } catch {
    return pathOrUrl;
  }
}
