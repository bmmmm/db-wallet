const VERSION = "db-wallet-v2-2026-11-09c";
const APP_SHELL = [
  "./",
  "./index.html",
  "./wallet.html",
  "./preview.html",
  "./style.css",
  "./themes.css",
  "./manifest.json",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
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

// A navigation waits this long for the network before it falls back to the
// cached page (the network response still updates the cache when it arrives).
const NAV_TIMEOUT_MS = 3000;

function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Only cache a genuine same-origin 200 — never poison the app shell with a
// 404, an opaque/redirected response, or a captive-portal login page.
function cacheIfGood(event, req, res) {
  if (!res || res.status !== 200 || res.type !== "basic" || res.redirected) return;
  const copy = res.clone();
  const put = caches
    .open(VERSION)
    .then((c) => c.put(req, copy))
    .catch(() => {});
  try {
    event.waitUntil(put);
  } catch (e) {
    // waitUntil is only callable while the event is active; the put still runs
  }
}

self.addEventListener("install", (event) => {
  // cache: "reload" bypasses the browser HTTP cache, so a new VERSION never
  // freezes a stale copy of a file that the HTTP cache still held.
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// Network first with a timeout. Every path ends in a Response:
//  - network answers in time → that response (cached if good);
//  - network fails → cached page (ignoring ?query), else index.html, else 503;
//  - network is slow → cached page if there is one, otherwise keep waiting for
//    the network (and on failure the same fallbacks as above).
function networkFirstPage(event, req) {
  const cachedPage = () =>
    caches.match(req, { ignoreSearch: true }).catch(() => undefined);
  const fallback = () =>
    cachedPage()
      .then((hit) => hit || caches.match("./index.html"))
      .catch(() => undefined)
      .then((hit) => hit || offlineResponse());

  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled || !res) return;
      settled = true;
      resolve(res);
    };
    const timer = setTimeout(() => {
      cachedPage().then(finish);
    }, NAV_TIMEOUT_MS);
    let network;
    try {
      network = fetch(req);
    } catch (e) {
      network = Promise.reject(e);
    }
    network.then(
      (res) => {
        clearTimeout(timer);
        cacheIfGood(event, req, res);
        finish(res);
      },
      () => {
        clearTimeout(timer);
        fallback().then(finish, () => finish(offlineResponse()));
      },
    );
  });
}

// Cache first for the app shell assets, network fill on a miss.
function cacheFirstAsset(event, req) {
  return caches
    .match(req)
    .then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        cacheIfGood(event, req, res);
        return res;
      });
    })
    .catch(() => offlineResponse());
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isHtml = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  event.respondWith(isHtml ? networkFirstPage(event, req) : cacheFirstAsset(event, req));
});
