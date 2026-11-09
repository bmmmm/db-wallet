// Node test harness: loads the original browser modules (window.dbWalletX IIFEs)
// into a fresh vm context with a tiny browser stand-in. No npm, no build — only
// node:vm. Each makeEnv() call gets its own localStorage, so tests are isolated.
//
// Objects created inside the vm context have their own prototypes; compare
// numbers/strings or go through JSON.stringify, not assert.deepStrictEqual on
// raw objects.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.join(__dirname, "..");

const DEFAULT_FILES = [
  "qrcodegen.js",
  "wallet-helpers.js",
  "hash-router.js",
  "migration.js",
  "action-codes.js",
  "wallet-storage.js",
  "wallet-import-v2.js",
  "wallet-summary.js",
  "wallet-sync.js",
  "wallet-actions.js",
];

// `quota` caps the length of a single stored value and simulates a full store
// (setItem throws, like the browser's QuotaExceededError).
function makeStorage(quota) {
  const m = new Map();
  const store = {
    quota: quota || Infinity,
    get length() {
      return m.size;
    },
    key(i) {
      return Array.from(m.keys())[i] ?? null;
    },
    getItem(k) {
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      v = String(v);
      if (v.length > store.quota) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem(k) {
      m.delete(k);
    },
    clear() {
      m.clear();
    },
  };
  return store;
}

// Fake location + session history for navigation tests: assigning
// location.hash pushes an entry and queues a "hashchange" (only when the
// fragment changes, like the browser); history.replaceState rewrites the
// current entry and fires nothing; location.href to another page is recorded
// in `nav.pageLoads` (the vm page never actually unloads). `nav.flush()`
// delivers queued hashchange events to the window listeners.
function makeNav(startUrl, win) {
  const entries = [new URL(startUrl).href];
  let index = 0;
  const queue = [];
  const nav = {
    entries,
    pageLoads: [],
    hashchanges: 0,
    get index() {
      return index;
    },
    get current() {
      return entries[index];
    },
    flush() {
      while (queue.length) {
        const ev = queue.shift();
        nav.hashchanges++;
        win._dispatch("hashchange", ev);
      }
    },
  };
  const fragment = (href) => {
    const i = href.indexOf("#");
    return i < 0 ? "" : href.slice(i + 1);
  };
  const push = (href) => {
    entries.splice(index + 1);
    entries.push(href);
    index = entries.length - 1;
  };
  nav.location = {
    get href() {
      return entries[index];
    },
    set href(v) {
      const next = new URL(String(v), entries[index]).href;
      const samePage = next.split("#")[0] === entries[index].split("#")[0];
      const old = entries[index];
      push(next);
      if (samePage && next.includes("#")) {
        if (fragment(old) !== fragment(next)) queue.push({ oldURL: old, newURL: next });
      } else {
        nav.pageLoads.push(next);
      }
    },
    get hash() {
      const f = fragment(entries[index]);
      return f ? "#" + f : "";
    },
    set hash(v) {
      const f = String(v).replace(/^#/, "");
      const old = entries[index];
      if (fragment(old) === f && old.includes("#")) return;
      push(old.split("#")[0] + "#" + f);
      queue.push({ oldURL: old, newURL: entries[index] });
    },
    get pathname() {
      return new URL(entries[index]).pathname;
    },
    reload() {
      nav.pageLoads.push(entries[index]);
    },
  };
  nav.history = {
    get length() {
      return entries.length;
    },
    get state() {
      return null;
    },
    replaceState(_state, _title, url) {
      if (url === undefined || url === null) return;
      entries[index] = new URL(String(url), entries[index]).href;
    },
    pushState(_state, _title, url) {
      push(new URL(String(url), entries[index]).href);
    },
    back() {
      if (index === 0) return;
      const old = entries[index];
      index--;
      if (fragment(old) !== fragment(entries[index])) {
        queue.push({ oldURL: old, newURL: entries[index] });
      }
    },
  };
  return nav;
}

// opts:
//   url        — start URL of the fake location/history (win._nav),
//                default https://example.invalid/wallet.html
//   quota      — max length of one stored value (simulated full storage)
//   deviceKey  — preset "db-wallet:device" (stable device identity)
//   storage    — reuse an existing storage (two tabs / two loads of one browser)
//   document   — replace the document stub (e.g. tests/fake-dom.js)
//   files      — module list, defaults to DEFAULT_FILES
function makeEnv(opts = {}) {
  const alerts = [];
  const listeners = Object.create(null);
  const localStorage = opts.storage || makeStorage(opts.quota);
  if (opts.deviceKey) localStorage.setItem("db-wallet:device", opts.deviceKey);
  const win = {
    console,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    crypto: globalThis.crypto,
    Blob,
    Response,
    CompressionStream,
    DecompressionStream,
    setTimeout,
    clearTimeout,
    URL,
    localStorage,
    sessionStorage: makeStorage(),
    alert: (m) => alerts.push(String(m)),
    confirm: () => true,
    prompt: () => null,
    document: opts.document || {
      body: { dataset: {} },
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      documentElement: {
        setAttribute() {},
        getAttribute() {
          return "";
        },
      },
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  win.window = win;
  win.globalThis = win;
  win._dispatch = (type, ev) => {
    const out = [];
    for (const fn of (listeners[type] || []).slice()) out.push(fn(ev || { type }));
    return out;
  };
  const nav = makeNav(opts.url || "https://example.invalid/wallet.html", win);
  win.location = nav.location;
  win.history = nav.history;
  win._nav = nav;
  const ctx = vm.createContext(win);
  for (const f of opts.files || DEFAULT_FILES) {
    vm.runInContext(fs.readFileSync(path.join(REPO, f), "utf8"), ctx, {
      filename: f,
    });
  }
  win._alerts = alerts;
  // Evaluate an expression inside the module realm (e.g. "({})" to get an
  // object with the context's own Object.prototype).
  win._eval = (code) => vm.runInContext(code, ctx);
  return win;
}

// Plain-data copy of a vm-context value (drops foreign prototypes).
function plain(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

module.exports = { makeEnv, makeStorage, makeNav, plain, REPO, DEFAULT_FILES };
