import { languageCodeToName, normalizeLanguageCode } from "../i18n";
import { apiRequest } from "./apiClient";
import { safeStorageGet, safeStorageSet } from "./storage";

const STORAGE_KEY = "aymo.preferences";

export interface UserPreferences {
  theme: "light" | "dark";
  language: string;
}

interface BackendPreferencesResponse {
  theme?: "light" | "dark";
  language?: string;
  languageCode?: string;
}

export async function loadPreferences(token?: string | null): Promise<UserPreferences> {
  if (!token) {
    return loadLocal();
  }

  try {
    const data = await apiRequest<BackendPreferencesResponse>("/api/protected/settings/preferences", {
      method: "GET",
      token,
    });
    if (data.theme && data.language) {
      const normalizedLanguage = normalizeLanguageCode(data.languageCode ?? data.language);
      const preferences = {
        theme: data.theme,
        language: normalizedLanguage,
      };
      persistLocal(preferences);
      return preferences;
    }
  } catch {
    // fallback to local storage when backend is unavailable
  }

  return loadLocal();
}

export async function savePreferences(
  token: string | null | undefined,
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const nextPreferences = { ...loadLocal(), ...patch };
  persistLocal(nextPreferences);

  if (!token) {
    return nextPreferences;
  }

  try {
    const response = await apiRequest<BackendPreferencesResponse>("/api/protected/settings/preferences", {
      method: "PUT",
      token,
      body: nextPreferences,
    });
    if (response.theme && response.language) {
      const normalizedLanguage = normalizeLanguageCode(response.languageCode ?? response.language);
      const saved = {
        theme: response.theme,
        language: normalizedLanguage,
      };
      persistLocal(saved);
      return saved;
    }
  } catch {
    // keep local persistence as fallback
  }

  return nextPreferences;
}

function loadLocal(): UserPreferences {
  try {
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return { theme: "light", language: "en" };

    const parsed = JSON.parse(raw) as UserPreferences;
    const normalizedLanguage = normalizeLanguageCode(parsed.language);
    if (
      (parsed.theme === "light" || parsed.theme === "dark") &&
      typeof parsed.language === "string" &&
      parsed.language.trim()
    ) {
      return { ...parsed, language: normalizedLanguage };
    }
  } catch {
    // ignore invalid JSON
  }

  return { theme: "light", language: "en" };
}

function persistLocal(preferences: UserPreferences): void {
  safeStorageSet(
    STORAGE_KEY,
    JSON.stringify({
      ...preferences,
      language: normalizeLanguageCode(preferences.language),
      languageLabel: languageCodeToName(preferences.language),
    }),
  );
}
