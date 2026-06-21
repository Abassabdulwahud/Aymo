const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
const TOKEN_STORAGE_KEY = "aymo.auth.token";

interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface AuthUser {
  id: number;
  full_name: string | null;
  email: string;
  provider: string;
}

export interface ProviderConfig {
  configured: boolean;
  enabled: boolean;
  clientId: string | null;
  redirectUri?: string | null;
  reason: string | null;
}

export interface AuthProvidersConfig {
  google: ProviderConfig;
  apple: ProviderConfig;
}

export interface ForgotPasswordResponse {
  message: string;
  reset_token?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) detail = payload.detail;
    } catch {
      // Ignore parsing failure and keep generic message.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export async function registerWithEmail(fullName: string, email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ full_name: fullName, email, password }),
  });
}

export async function loginWithEmail(email: string, password: string): Promise<string> {
  const token = await request<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return token.access_token;
}

export async function loginWithGoogle(googleToken: string): Promise<string> {
  const token = await request<TokenResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ token: googleToken }),
  });
  return token.access_token;
}

export async function loginWithApple(appleToken: string): Promise<string> {
  const token = await request<TokenResponse>("/auth/apple", {
    method: "POST",
    body: JSON.stringify({ token: appleToken }),
  });
  return token.access_token;
}

export async function fetchAuthProviders(): Promise<AuthProvidersConfig> {
  return request<AuthProvidersConfig>("/auth/providers", {
    method: "GET",
  });
}

export async function requestPasswordReset(email: string): Promise<ForgotPasswordResponse> {
  return request<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const payload = await request<TokenResponse>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  return payload.access_token;
}

export async function fetchCurrentUser(jwtToken: string): Promise<AuthUser> {
  return request<AuthUser>("/api/protected/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwtToken}`,
    },
  });
}

export function saveAuthToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function loadAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}
