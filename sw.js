/* MBG Watch — service worker
   Only job: cache the static app shell so the dashboard (1) qualifies as an
   installable PWA and (2) still opens if the network drops. Every SPPG /
   CCTV / alert value is generated client-side from data.js, so there is
   nothing dynamic to cache — this is intentionally a tiny, boring worker. */

const CACHE_VERSION = "mbg-watch-v1";
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

// Cache-first for the app shell, falling back to network; network-first for
// everything else so nothing stale ever blocks a live request.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

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
