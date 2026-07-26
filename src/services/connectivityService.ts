/**
 * connectivityService.ts — Phase 2: Cloud Synchronization Foundation
 *
 * Provides reliable browser connectivity detection for the SyncService.
 *
 * Strategy (most reliable to least):
 *   1. Primary: window 'online'/'offline' events (instantaneous)
 *   2. Probe: lightweight fetch to a known stable URL (confirms actual
 *      connectivity, not just local network adapter state)
 *
 * navigator.onLine is checked synchronously but is unreliable on its own
 * (returns true when on a LAN with no internet, for example). The probe
 * provides ground truth and is used on initial load and after reconnect.
 *
 * The service is a pure event emitter — no React, no UI coupling.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectivityHandler = (online: boolean) => void;

// ─── Internal State ───────────────────────────────────────────────────────────

const handlers = new Set<ConnectivityHandler>();
let currentlyOnline: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
let probeTimeoutId: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

// ─── Probe ────────────────────────────────────────────────────────────────────

/**
 * Probes real internet connectivity by making a lightweight HEAD request.
 * Uses /favicon.ico on the same origin (always available after caching).
 * Falls back to navigator.onLine on fetch failure so it never throws.
 */
async function probeConnectivity(): Promise<boolean> {
  try {
    // Use a cache-busted request to avoid getting a cached response
    // while actually being offline.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`/manifest.json?_probe=${Date.now()}`, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    // Network error, timeout, or fetch was aborted.
    return false;
  }
}

// ─── Notify ───────────────────────────────────────────────────────────────────

function notify(online: boolean): void {
  if (online === currentlyOnline) return; // No change — skip.
  currentlyOnline = online;
  for (const handler of handlers) {
    try {
      handler(online);
    } catch (err) {
      console.warn("[ConnectivityService] Handler threw:", err);
    }
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function handleOnline(): void {
  // The 'online' event fires when the browser thinks we have internet.
  // Probe first to confirm before notifying SyncService.
  if (probeTimeoutId !== null) clearTimeout(probeTimeoutId);
  probeTimeoutId = setTimeout(async () => {
    const confirmed = await probeConnectivity();
    notify(confirmed);
  }, 500); // Small debounce for flappy connections.
}

function handleOffline(): void {
  if (probeTimeoutId !== null) {
    clearTimeout(probeTimeoutId);
    probeTimeoutId = null;
  }
  notify(false);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initializes the connectivity service.
 * Safe to call multiple times — only initializes once.
 *
 * Called once by SyncService.initialize().
 */
export async function initConnectivityService(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined") return;

  window.addEventListener("online", handleOnline, { passive: true });
  window.addEventListener("offline", handleOffline, { passive: true });

  // Run an initial probe to get ground truth at startup.
  const online = navigator.onLine ? await probeConnectivity() : false;
  currentlyOnline = online;
}

/**
 * Returns the current connectivity state.
 * Synchronous — uses the last known value from the event system.
 */
export function isOnline(): boolean {
  return currentlyOnline;
}

/**
 * Subscribes to connectivity changes.
 * The handler is called with `true` when connection is established and
 * `false` when it is lost.
 *
 * @returns An unsubscribe function. Call it to stop receiving updates.
 *
 * @example
 * const unsubscribe = onConnectivityChange((online) => {
 *   if (online) syncService.start();
 *   else syncService.pause();
 * });
 * // Later:
 * unsubscribe();
 */
export function onConnectivityChange(handler: ConnectivityHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * Manually triggers a connectivity probe and fires handlers if the
 * state changed. Useful after returning from the background (visibilitychange).
 */
export async function recheckConnectivity(): Promise<boolean> {
  const online = navigator.onLine ? await probeConnectivity() : false;
  notify(online);
  return online;
}

/**
 * Returns a human-readable label for the current connectivity state.
 * Used in the Workspace Health panel.
 */
export function connectivityLabel(): string {
  return currentlyOnline ? "Online" : "Offline";
}

// ─── Visibility-Based Recheck ─────────────────────────────────────────────────
// When the tab becomes visible again, re-probe in case the device was
// suspended (e.g. laptop lid close) and navigator.onLine is stale.

if (typeof document !== "undefined") {
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") {
        void recheckConnectivity();
      }
    },
    { passive: true },
  );
}
