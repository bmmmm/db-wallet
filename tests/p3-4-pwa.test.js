// P3.4: PWA icons and service-worker strategy.
//  - Static: every APP_SHELL entry, manifest icon and page icon link exists in
//    the repo and is deployed by the Pages allowlist (a missing app-shell file
//    makes cache.addAll — and with it the whole SW install — fail).
//  - Icons: real PNGs with the declared size, reproducible from
//    scripts/make-icons.js.
//  - service-worker.js runs in a vm with fake caches/fetch/self/clients and a
//    manual clock: install, activate, navigation (success, offline, slow
//    network), assets, and requests the worker must leave alone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const SW_SRC = read("service-worker.js");
const APP_SHELL = Array.from(
  /APP_SHELL = \[([\s\S]*?)\];/.exec(SW_SRC)[1].matchAll(/"\.\/([^"]*)"/g),
).map((m) => m[1]);
const MANIFEST = JSON.parse(read("manifest.json"));
const PAGES = ["index.html", "wallet.html", "preview.html"];

// Files the Pages workflow copies: the tokens of its `cp … _site/` line.
const PAGES_YML = read(".github/workflows/pages.yml");
const CP_TOKENS = /\n\s*cp ([^\n]+) _site\//.exec(PAGES_YML)[1].trim().split(/\s+/);
function deployed(file) {
  return CP_TOKENS.some((tok) => {
    const t = tok.replace(/^\.\//, "");
    const re = new RegExp("^" + t.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    return re.test(file);
  });
}

test("every APP_SHELL file exists and is in the Pages allowlist", () => {
  const bad = [];
  for (const f of APP_SHELL) {
    if (f === "") continue; // "./" = the directory index
    if (!fs.existsSync(path.join(REPO, f))) bad.push(`${f}: missing in repo`);
    if (!deployed(f)) bad.push(`${f}: not deployed by pages.yml`);
  }
  assert.deepEqual(bad, []);
  assert.ok(APP_SHELL.includes("index.html"), "./ needs index.html");
});

test("every manifest icon exists, is deployed and precached", () => {
  assert.ok(MANIFEST.icons.length >= 4);
  for (const icon of MANIFEST.icons) {
    assert.ok(fs.existsSync(path.join(REPO, icon.src)), icon.src);
    assert.ok(deployed(icon.src), icon.src + " not deployed");
    assert.ok(APP_SHELL.includes(icon.src), icon.src + " not in APP_SHELL");
  }
  const purposes = MANIFEST.icons.map((i) => `${i.sizes}/${i.purpose}`);
  for (const want of ["192x192/any", "512x512/any", "512x512/maskable"]) {
    assert.ok(purposes.includes(want), want);
  }
  assert.ok(!MANIFEST.icons.some((i) => /any maskable/.test(i.purpose)), "no combined purpose");
});

test("every icon link on the app pages exists, is deployed and precached", () => {
  for (const page of PAGES) {
    const html = read(page);
    const links = Array.from(html.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g));
    assert.ok(links.some((m) => m[1] === "apple-touch-icon"), page + ": apple-touch-icon");
    for (const m of links) {
      assert.ok(fs.existsSync(path.join(REPO, m[2])), `${page}: ${m[2]}`);
      assert.ok(deployed(m[2]), `${page}: ${m[2]} not deployed`);
      assert.ok(APP_SHELL.includes(m[2]), `${page}: ${m[2]} not in APP_SHELL`);
    }
  }
});

test("colors.html/colors.css are no longer precached (E6)", () => {
  assert.ok(!APP_SHELL.includes("colors.html"));
  assert.ok(!APP_SHELL.includes("colors.css"));
});

function pngInfo(buf) {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), depth: buf[24], type: buf[25] };
}

test("icons: PNG header and the declared size", () => {
  const want = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-maskable-512.png": 512,
    "apple-touch-icon.png": 180,
  };
  for (const [f, size] of Object.entries(want)) {
    const info = pngInfo(fs.readFileSync(path.join(REPO, f)));
    assert.deepEqual([info.w, info.h, info.depth, info.type], [size, size, 8, 6], f);
  }
});

test("icons are reproducible from scripts/make-icons.js (small sizes)", () => {
  const { ICONS, render } = require("../scripts/make-icons.js");
  for (const f of ["icon-192.png", "apple-touch-icon.png"]) {
    assert.ok(render(ICONS[f]).equals(fs.readFileSync(path.join(REPO, f))), f + " is stale");
  }
});

test("maskable and apple icons are opaque, the 'any' icon has transparent corners", () => {
  const zlib = require("zlib");
  function alphaAt(file, x, y) {
    const buf = fs.readFileSync(path.join(REPO, file));
    const { w } = pngInfo(buf);
    const idat = [];
    let o = 8;
    while (o < buf.length) {
      const len = buf.readUInt32BE(o);
      const type = buf.subarray(o + 4, o + 8).toString("ascii");
      if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const row = y * (w * 4 + 1);
    assert.equal(raw[row], 0, "filter none");
    return raw[row + 1 + x * 4 + 3];
  }
  assert.equal(alphaAt("icon-512.png", 0, 0), 0);
  assert.equal(alphaAt("icon-512.png", 256, 256), 255);
  assert.equal(alphaAt("icon-maskable-512.png", 0, 0), 255);
  assert.equal(alphaAt("apple-touch-icon.png", 0, 0), 255);
});

// --- service worker in a vm --------------------------------------------------

const ORIGIN = "https://app.example";
const BASE = ORIGIN + "/db-wallet/";

class FakeRequest {
  constructor(input, init = {}) {
    const src = typeof input === "object" && input ? input : null;
    this.url = new URL(src ? src.url : String(input), BASE).href;
    this.method = init.method || (src && src.method) || "GET";
    this.mode = init.mode || (src && src.mode) || "cors";
    this.cache = init.cache || (src && src.cache) || "default";
    const h = init.headers || (src && src.headers) || {};
    this.headers = { get: (k) => h[k.toLowerCase()] || null };
  }
}

function res(body, opts = {}) {
  const r = {
    body,
    status: opts.status || 200,
    type: opts.type || "basic",
    redirected: !!opts.redirected,
    ok: (opts.status || 200) < 300,
    clone: () => res(body, opts),
  };
  return r;
}

function keyOf(req, ignoreSearch) {
  const u = new URL(typeof req === "string" ? req : req.url, BASE);
  if (ignoreSearch) u.search = "";
  u.hash = "";
  return u.href;
}

function makeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, r) => {
        m.set(keyOf(req), r);
      },
      match: async (req, o) => lookup(m, req, o),
      addAll: async (reqs) => {
        const got = [];
        for (const rq of reqs) {
          const r = await sw.fetchImpl(rq);
          if (!r.ok) throw new TypeError("addAll: bad status " + r.status);
          got.push([rq, r]);
        }
        for (const [rq, r] of got) m.set(keyOf(rq), r);
      },
    };
  };
  function lookup(m, req, o) {
    const ignore = !!(o && o.ignoreSearch);
    const want = keyOf(req, ignore);
    for (const [k, v] of m) {
      if ((ignore ? keyOf(k, true) : k) === want) return v;
    }
    return undefined;
  }
  const sw = {
    stores,
    fetchImpl: null,
    api: {
      open,
      keys: async () => Array.from(stores.keys()),
      delete: async (name) => stores.delete(name),
      match: async (req, o) => {
        for (const m of stores.values()) {
          const hit = lookup(m, req, o);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
  return sw;
}

function loadSw() {
  const handlers = {};
  const timers = [];
  const cachesFake = makeCaches();
  const fetchLog = [];
  const state = { skipWaiting: 0, claim: 0 };
  const env = {
    fetch: (req) => {
      if (typeof req === "string") req = new FakeRequest(req);
      fetchLog.push(req);
      return env.network(req);
    },
    network: () => Promise.reject(new TypeError("offline")),
  };
  cachesFake.fetchImpl = (req) => env.fetch(req);
  const ctx = {
    self: null,
    caches: cachesFake.api,
    fetch: (req) => env.fetch(req),
    Request: FakeRequest,
    Response,
    URL,
    Promise,
    console,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, done: false });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].done = true;
    },
  };
  ctx.self = {
    location: { origin: ORIGIN, href: BASE + "service-worker.js" },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {
      state.skipWaiting++;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        state.claim++;
        return Promise.resolve();
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx, { filename: "service-worker.js" });
  const VERSION = vm.runInContext("VERSION", ctx);
  const fireTimers = () => {
    for (const t of timers) {
      if (!t.done) {
        t.done = true;
        t.fn();
      }
    }
  };
  async function dispatchFetch(req) {
    const waits = [];
    let responded = null;
    handlers.fetch({
      request: req,
      respondWith: (p) => (responded = Promise.resolve(p)),
      waitUntil: (p) => waits.push(p),
    });
    return { responded, settle: () => Promise.all(waits) };
  }
  async function install() {
    const waits = [];
    handlers.install({ waitUntil: (p) => waits.push(p) });
    return Promise.all(waits);
  }
  async function activate() {
    const waits = [];
    handlers.activate({ waitUntil: (p) => waits.push(p) });
    return Promise.all(waits);
  }
  return {
    env,
    handlers,
    timers,
    fireTimers,
    caches: cachesFake,
    fetchLog,
    state,
    VERSION,
    dispatchFetch,
    install,
    activate,
  };
}

const nav = (p, extra = {}) => new FakeRequest(BASE + p, { mode: "navigate", ...extra });
const asset = (p) => new FakeRequest(BASE + p);
const tick = () => new Promise((r) => setImmediate(r));

async function installed() {
  const sw = loadSw();
  sw.env.network = async (req) => res("net:" + new URL(req.url).pathname);
  await sw.install();
  sw.fetchLog.length = 0;
  return sw;
}

test("install precaches the whole APP_SHELL with cache: 'reload', then skipWaiting", async () => {
  const sw = loadSw();
  sw.env.network = async (req) => res("net:" + req.url);
  await sw.install();
  assert.equal(sw.fetchLog.length, APP_SHELL.length);
  assert.ok(sw.fetchLog.every((r) => r.cache === "reload"), "every precache request bypasses the HTTP cache");
  assert.equal(sw.caches.stores.get(sw.VERSION).size, APP_SHELL.length);
  assert.equal(sw.state.skipWaiting, 1);
});

test("install fails as a whole when one app-shell file is missing", async () => {
  const sw = loadSw();
  sw.env.network = async (req) => (req.url.endsWith("icon-192.png") ? res("", { status: 404 }) : res("ok"));
  await assert.rejects(sw.install());
  assert.equal(sw.state.skipWaiting, 0);
});

test("activate deletes old caches, keeps the current one, claims clients", async () => {
  const sw = await installed();
  await sw.caches.api.open("db-wallet-v2-old");
  await sw.activate();
  assert.deepEqual(Array.from(sw.caches.stores.keys()), [sw.VERSION]);
  assert.equal(sw.state.claim, 1);
});

test("non-GET and foreign-origin requests are left alone", async () => {
  const sw = await installed();
  const post = await sw.dispatchFetch(new FakeRequest(BASE + "wallet.html", { method: "POST" }));
  assert.equal(post.responded, null);
  const foreign = await sw.dispatchFetch(new FakeRequest("https://cdn.example/x.js"));
  assert.equal(foreign.responded, null);
  assert.equal(sw.fetchLog.length, 0);
});

test("navigation online: network response, cache updated", async () => {
  const sw = await installed();
  sw.env.network = async () => res("fresh wallet");
  const { responded, settle } = await sw.dispatchFetch(nav("wallet.html"));
  assert.equal((await responded).body, "fresh wallet");
  await settle();
  const cached = await sw.caches.api.match(BASE + "wallet.html");
  assert.equal(cached.body, "fresh wallet");
});

test("navigation online with a 404 or a redirect: passed through, not cached", async () => {
  const sw = await installed();
  sw.env.network = async () => res("not found", { status: 404 });
  let r = await sw.dispatchFetch(nav("wallet.html"));
  assert.equal((await r.responded).status, 404);
  await r.settle();
  sw.env.network = async () => res("portal", { redirected: true });
  r = await sw.dispatchFetch(nav("wallet.html"));
  assert.equal((await r.responded).body, "portal");
  await r.settle();
  assert.equal((await sw.caches.api.match(BASE + "wallet.html")).body, "net:/db-wallet/wallet.html");
});

test("navigation offline: cached page, also with a query string", async () => {
  const sw = await installed();
  sw.env.network = () => Promise.reject(new TypeError("offline"));
  const { responded } = await sw.dispatchFetch(nav("wallet.html?x=1"));
  assert.equal((await responded).body, "net:/db-wallet/wallet.html", "no fallback to index.html");
});

test("navigation offline to an unknown page: index.html, empty cache: 503", async () => {
  const sw = await installed();
  sw.env.network = () => Promise.reject(new TypeError("offline"));
  let r = await sw.dispatchFetch(nav("nope.html"));
  assert.equal((await r.responded).body, "net:/db-wallet/index.html");
  const empty = loadSw();
  r = await empty.dispatchFetch(nav("wallet.html"));
  const out = await r.responded;
  assert.equal(out.status, 503);
});

test("navigation when fetch throws synchronously: still answered", async () => {
  const sw = await installed();
  sw.env.network = () => {
    throw new TypeError("boom");
  };
  const { responded } = await sw.dispatchFetch(nav("wallet.html"));
  assert.equal((await responded).body, "net:/db-wallet/wallet.html");
});

test("slow network: after the timeout the cached page, the late response still updates the cache", async () => {
  const sw = await installed();
  let release;
  sw.env.network = () => new Promise((resolve) => (release = resolve));
  const { responded, settle } = await sw.dispatchFetch(nav("wallet.html"));
  assert.equal(sw.timers.length, 1);
  assert.ok(sw.timers[0].ms >= 1000 && sw.timers[0].ms <= 5000, "timeout " + sw.timers[0].ms);
  let answered = null;
  responded.then((r) => (answered = r));
  await tick();
  assert.equal(answered, null, "waits for the network until the timeout");
  sw.fireTimers();
  await tick();
  await tick();
  assert.equal(answered && answered.body, "net:/db-wallet/wallet.html");
  release(res("late but fresh"));
  await tick();
  await settle();
  assert.equal((await sw.caches.api.match(BASE + "wallet.html")).body, "late but fresh");
});

test("slow network, nothing cached: keeps waiting for the network instead of failing", async () => {
  const sw = loadSw(); // nothing installed
  let release;
  sw.env.network = () => new Promise((resolve) => (release = resolve));
  const { responded } = await sw.dispatchFetch(nav("wallet.html"));
  let answered = null;
  responded.then((r) => (answered = r));
  sw.fireTimers();
  await tick();
  await tick();
  assert.equal(answered, null);
  release(res("finally"));
  await tick();
  assert.equal(answered && answered.body, "finally");
});

test("slow network that then fails, nothing cached: 503, never hangs", async () => {
  const sw = loadSw();
  let fail;
  sw.env.network = () => new Promise((_, reject) => (fail = reject));
  const { responded } = await sw.dispatchFetch(nav("wallet.html"));
  sw.fireTimers();
  await tick();
  fail(new TypeError("offline"));
  assert.equal((await responded).status, 503);
});

test("assets: cache first; a miss goes to the network and is cached; offline miss → 503", async () => {
  const sw = await installed();
  sw.env.network = async () => res("should not be fetched");
  let r = await sw.dispatchFetch(asset("wallet-ui.js"));
  assert.equal((await r.responded).body, "net:/db-wallet/wallet-ui.js");
  assert.equal(sw.fetchLog.length, 0);

  sw.env.network = async () => res("extra");
  r = await sw.dispatchFetch(asset("extra.txt"));
  assert.equal((await r.responded).body, "extra");
  await r.settle();
  assert.equal((await sw.caches.api.match(BASE + "extra.txt")).body, "extra");

  sw.env.network = () => Promise.reject(new TypeError("offline"));
  r = await sw.dispatchFetch(asset("missing.js"));
  assert.equal((await r.responded).status, 503);
});
