// AYMO Service Worker — Phase 3A
// Strategy: Cache-First for static assets, App-Shell for navigation.
// The app shell (index.html) is served from cache so AYMO loads offline.

const CACHE_NAME = "aymo-shell-v12";

// Files to pre-cache on install.
const PRECACHE_URLS = ["/", "/index.html", "/manifest.json"];

// ─── Install ──────────────────────────────────────────────────────────────────
// Pre-cache the app shell and take immediate control.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
// Remove stale caches from previous SW versions and claim clients.
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

  // Skip cross-origin requests, WebSockets, and API/Auth endpoints.
  if (
    url.origin !== self.location.origin ||
    request.url.startsWith("ws:") ||
    request.url.startsWith("wss:")
  ) {
    return;
  }

  // Never cache API or backend authentication endpoints.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/ws/")
  ) {
    return;
  }

  // ── Navigation requests (HTML) → App Shell strategy ──────────────────────
  // Return cached app shell (index.html) so AYMO loads instantly offline.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/").then((cachedRoot) => {
        if (cachedRoot) return cachedRoot;
        return caches.match("/index.html").then((cachedHtml) => {
          if (cachedHtml) return cachedHtml;
          return fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put("/", copy);
                cache.put("/index.html", response.clone());
              });
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // ── Static assets → Cache-First with Network Fallback ─────────────────────
  // Serve JS bundles, CSS, fonts, and images from cache. On cache miss, fetch from network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
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
          // If offline and asset is missing, return nothing
        });
    })
  );
});
