import { AIProvider } from "../types";

const STORAGE_KEY = "aymo.preferences";

export interface UserPreferences {
  aiProvider: AIProvider;
}

interface BackendPreferencesResponse {
  aiProvider?: AIProvider;
}

export async function loadPreferences(): Promise<UserPreferences> {
  try {
    const response = await fetch("/api/settings/preferences", { method: "GET" });
    if (response.ok) {
      const data = (await response.json()) as BackendPreferencesResponse;
      if (data.aiProvider) {
        persistLocal({ aiProvider: data.aiProvider });
        return { aiProvider: data.aiProvider };
      }
    }
  } catch {
    // fallback to local storage when backend is unavailable in preview mode
  }

  return loadLocal();
}

export async function saveAIProviderPreference(aiProvider: AIProvider): Promise<void> {
  persistLocal({ aiProvider });

  try {
    await fetch("/api/settings/preferences", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ aiProvider }),
    });
  } catch {
    // keep local persistence as fallback
  }
}

function loadLocal(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { aiProvider: "gemini" };

    const parsed = JSON.parse(raw) as UserPreferences;
    if (parsed.aiProvider === "gemini" || parsed.aiProvider === "openai" || parsed.aiProvider === "deepseek") {
      return parsed;
    }
  } catch {
    // ignore invalid JSON
  }

  return { aiProvider: "gemini" };
}

function persistLocal(preferences: UserPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
