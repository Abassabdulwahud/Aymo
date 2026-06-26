import { apiRequest } from "./apiClient";
import { safeStorageGet, safeStorageRemove, safeStorageSet } from "./storage";

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

export async function registerWithEmail(fullName: string, email: string, password: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/auth/register", {
    method: "POST",
    body: { full_name: fullName, email, password },
  });
}

export async function loginWithEmail(email: string, password: string): Promise<string> {
  const token = await apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return token.access_token;
}

export async function loginWithGoogle(googleToken: string): Promise<string> {
  const token = await apiRequest<TokenResponse>("/auth/google", {
    method: "POST",
    body: { token: googleToken },
  });
  return token.access_token;
}

export async function loginWithApple(appleToken: string): Promise<string> {
  const token = await apiRequest<TokenResponse>("/auth/apple", {
    method: "POST",
    body: { token: appleToken },
  });
  return token.access_token;
}

export async function fetchAuthProviders(): Promise<AuthProvidersConfig> {
  return apiRequest<AuthProvidersConfig>("/auth/providers", {
    method: "GET",
  });
}

export async function requestPasswordReset(email: string): Promise<ForgotPasswordResponse> {
  return apiRequest<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const payload = await apiRequest<TokenResponse>("/auth/reset-password", {
    method: "POST",
    body: { token, new_password: newPassword },
  });
  return payload.access_token;
}

export async function fetchCurrentUser(jwtToken: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/protected/me", {
    method: "GET",
    token: jwtToken,
  });
}

export function saveAuthToken(token: string): void {
  safeStorageSet(TOKEN_STORAGE_KEY, token);
}

export function loadAuthToken(): string | null {
  return safeStorageGet(TOKEN_STORAGE_KEY);
}

export function clearAuthToken(): void {
  safeStorageRemove(TOKEN_STORAGE_KEY);
}
