const VERSION = "db-wallet-v2-2026-06-15";
const APP_SHELL = [
  "./",
  "./index.html",
  "./wallet.html",
  "./preview.html",
  "./colors.html",
  "./style.css",
  "./themes.css",
  "./colors.css",
  "./manifest.json",
  "./favicon.svg",
  "./theme.js",
  "./import-preview.js",
  "./qrcodegen.js",
  "./wallet-helpers.js",
  "./hash-router.js",
  "./migration.js",
  "./action-codes.js",
  "./wallet-storage.js",
  "./wallet-import-v2.js",
  "./wallet-summary.js",
  "./wallet-sync.js",
  "./wallet-messages.js",
  "./wallet-device-ui.js",
  "./wallet-sync-ui.js",
  "./wallet-export-ui.js",
  "./wallet-history-ui.js",
  "./wallet-hash-actions.js",
  "./wallet-actions.js",
  "./wallet-ui.js",
  "./index-ui.js",
  "./self-check.js",
  "./sw-register.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a genuine same-origin 200 — never poison the app shell with
          // a 404, an opaque/redirected response, or a captive-portal login page.
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    }),
  );
});
