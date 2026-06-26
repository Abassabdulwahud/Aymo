import { AIProvider } from "../types";
import { safeStorageGet, safeStorageSet } from "./storage";

const STORAGE_KEY = "aymo.aiProvider";

export function normalizeAIProvider(value: string | null | undefined): AIProvider {
  if (value === "openai" || value === "gemini" || value === "deepseek") {
    return value;
  }

  return "gemini";
}

export function loadAIProvider(): AIProvider {
  return normalizeAIProvider(safeStorageGet(STORAGE_KEY));
}

export function saveAIProvider(provider: AIProvider): void {
  safeStorageSet(STORAGE_KEY, provider);
}
