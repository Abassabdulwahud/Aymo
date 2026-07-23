export interface StorageHealth {
  indexedDbAvailable: boolean;
  persistentStorageSupported: boolean;
  persistentStorageEnabled: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
  usageRatio: number | null;
  status: "healthy" | "warning" | "critical" | "unavailable";
  messages: string[];
}

function formatBytes(value: number | null): string {
  if (value === null) return "Unknown";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatStorageBytes(value: number | null): string {
  return formatBytes(value);
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) {
    return null;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const indexedDbAvailable = "indexedDB" in window;
  const persistentStorageSupported = Boolean(navigator.storage?.persist);

  let persistentStorageEnabled: boolean | null = null;
  if (navigator.storage?.persisted) {
    try {
      persistentStorageEnabled = await navigator.storage.persisted();
    } catch {
      persistentStorageEnabled = false;
    }
  }

  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
    } catch {
      quotaBytes = null;
      usageBytes = null;
    }
  }

  const availableBytes = quotaBytes !== null && usageBytes !== null
    ? Math.max(0, quotaBytes - usageBytes)
    : null;
  const usageRatio = quotaBytes !== null && usageBytes !== null && quotaBytes > 0
    ? usageBytes / quotaBytes
    : null;

  const messages: string[] = [];
  let status: StorageHealth["status"] = "healthy";

  if (!indexedDbAvailable) {
    status = "unavailable";
    messages.push("Local workspace storage is unavailable in this browser.");
  }

  if (persistentStorageSupported && persistentStorageEnabled === false) {
    status = status === "unavailable" ? status : "warning";
    messages.push("Persistent storage is not enabled yet.");
  }

  if (usageRatio !== null && usageRatio >= 0.9) {
    status = status === "unavailable" ? status : "critical";
    messages.push("Storage is almost full.");
  } else if (usageRatio !== null && usageRatio >= 0.75) {
    status = status === "healthy" ? "warning" : status;
    messages.push("Storage is getting full.");
  }

  if (messages.length === 0) {
    messages.push("Local storage is healthy.");
  }

  return {
    indexedDbAvailable,
    persistentStorageSupported,
    persistentStorageEnabled,
    quotaBytes,
    usageBytes,
    availableBytes,
    usageRatio,
    status,
    messages,
  };
}
