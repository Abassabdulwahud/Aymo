// AYMO Service Worker — Phase 1B
// Strategy: Cache-First for assets, App-Shell for navigation.
// The app shell (index.html) is served from cache so AYMO loads offline.

const CACHE_NAME = "aymo-shell-v10";

// Files to pre-cache on install.
// index.html is the only guaranteed stable path at build time.
// All other assets are cached dynamically on first fetch.
const PRECACHE_URLS = ["/"];

// ─── Install ──────────────────────────────────────────────────────────────────
// Pre-cache the app shell and immediately take control.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
// Remove any stale caches from previous SW versions and claim all clients.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin requests and navigation requests to this origin.
  // Skip cross-origin requests (Google Fonts, CDNs, API calls, WebSockets).
  if (
    url.origin !== self.location.origin ||
    request.url.startsWith("ws:") ||
    request.url.startsWith("wss:")
  ) {
    return;
  }

  // Skip API and backend requests — never cache dynamic data.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/ws/")
  ) {
    return;
  }

  // ── Navigation requests (HTML) → App Shell strategy ──────────────────────
  // Always serve index.html from cache so the app loads offline.
  // Fall back to network if cache misses (first load).
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/").then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put("/", response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Static assets → Cache-First with Network Fallback ─────────────────────
  // JS bundles, CSS, fonts, images, icons — serve from cache instantly.
  // On cache miss, fetch from network and store for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Only cache successful, non-opaque responses.
          if (!response || response.status !== 200 || response.type === "opaque") {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // If the network is unavailable and we have no cache entry,
          // return nothing (browser will show its own offline indicator
          // for sub-resources, but the app shell already loaded).
        });
    })
  );
});
