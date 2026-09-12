/* MBG Watch — service worker
   Only job: cache the static app shell so the dashboard (1) qualifies as an
   installable PWA and (2) still opens if the network drops. Every SPPG /
   CCTV / alert value is generated client-side from data.js, so there is
   nothing dynamic to cache — this is intentionally a tiny, boring worker.

   BUGFIX (this version): the previous worker cached index.html/app.js/
   style.css/data.js CACHE-FIRST under a version string that never changed
   between deploys. Because the browser only re-installs a service worker
   when sw.js itself changes byte-for-byte, and this file wasn't touched
   across several rounds of edits, every new deploy of index.html/app.js/
   style.css kept getting silently ignored — the browser just kept serving
   whatever was cached from the very first install. If a cached app.js ever
   ended up paired with a newer index.html (different element IDs, etc.),
   any `getElementById(...).addEventListener(...)` on a now-missing element
   throws at startup, which happens before the splash screen's own
   DOMContentLoaded handler runs — freezing the app on the splash screen
   exactly the way this was reported. Fix: the app shell (HTML/CSS/JS) is
   now NETWORK-FIRST, so a live connection always gets the latest deploy;
   only truly static binary assets (icons) stay cache-first. The cache
   version is also bumped so anyone already stuck with the old stale cache
   gets it purged on next load. */

const CACHE_VERSION = "mbg-watch-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./assets/icons/logo.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./favicon.ico",
];
// Files that change on (almost) every deploy — must always prefer network.
const NETWORK_FIRST = /\.(html|js|css|webmanifest)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isShellFile = url.pathname === "/" || NETWORK_FIRST.test(url.pathname);

  if (isShellFile) {
    // Network-first: always try to get the current deploy. Only fall back
    // to whatever's cached (or nothing) if the network request itself
    // fails, e.g. actually offline.
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for stable binary assets (icons, fonts, favicon) — these
  // don't change between deploys, so serving instantly from cache is safe.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});

