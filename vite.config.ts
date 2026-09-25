import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Inline Vite plugin: injectSwPrecache
 *
 * Runs after every production build (closeBundle hook).
 * Scans dist/assets/ for the current hashed JS/CSS/MJS bundles,
 * builds the PRECACHE_URLS list, and writes it into dist/sw.js by
 * replacing the __AYMO_PRECACHE_URLS__ placeholder.
 *
 * This ensures every Vercel deployment has the correct asset filenames
 * baked into the Service Worker — no manual updates required.
 */
function injectSwPrecache(): Plugin {
  return {
    name: "aymo-inject-sw-precache",
    // Only run in production builds (not dev server).
    apply: "build",
    closeBundle() {
      const distDir = resolve(__dirname, "dist");
      const assetsDir = join(distDir, "assets");
      const swPath = join(distDir, "sw.js");

      // ── Discover hashed assets ────────────────────────────────────────────
      let assetFiles: string[] = [];
      try {
        assetFiles = readdirSync(assetsDir);
      } catch {
        console.warn("[aymo-inject-sw-precache] dist/assets/ not found — skipping SW injection.");
        return;
      }

      // Critical app-shell assets: all JS, CSS, MJS in dist/assets/
      // EXCLUDE: testSync-*.js — it belongs to test-sync.html, not the main app.
      const EXCLUDE_PATTERNS = [/^testSync-/];

      const criticalAssets = assetFiles
        .filter((file) => /\.(js|css|mjs)$/.test(file))
        .filter((file) => !EXCLUDE_PATTERNS.some((re) => re.test(file)))
        .map((file) => `/assets/${file}`);

      if (criticalAssets.length === 0) {
        console.warn("[aymo-inject-sw-precache] No assets found in dist/assets/ — check build output.");
      }

      // ── Build the full precache list ──────────────────────────────────────
      const shellUrls = ["/", "/index.html", "/manifest.json"];
      const allUrls = [...shellUrls, ...criticalAssets.sort()];

      const precacheJson = JSON.stringify(allUrls, null, 2);

      console.log("[aymo-inject-sw-precache] Precache URLs:");
      allUrls.forEach((u) => console.log("  ", u));

      // ── Inject into dist/sw.js ────────────────────────────────────────────
      let swContent: string;
      try {
        swContent = readFileSync(swPath, "utf-8");
      } catch {
        console.error("[aymo-inject-sw-precache] dist/sw.js not found — cannot inject precache.");
        return;
      }

      if (!swContent.includes("__AYMO_PRECACHE_URLS__")) {
        console.error(
          "[aymo-inject-sw-precache] Placeholder __AYMO_PRECACHE_URLS__ not found in dist/sw.js. " +
          "Ensure public/sw.js contains: const PRECACHE_URLS = __AYMO_PRECACHE_URLS__;"
        );
        return;
      }

      const injected = swContent.replace("__AYMO_PRECACHE_URLS__", precacheJson);
      writeFileSync(swPath, injected, "utf-8");

      console.log(`[aymo-inject-sw-precache] dist/sw.js updated — ${allUrls.length} URLs in precache.`);
    },
  };
}

export default defineConfig({
  plugins: [react(), injectSwPrecache()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        testSync: resolve(__dirname, "test-sync.html"),
      },
    },
  },
});
