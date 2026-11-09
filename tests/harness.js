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

// opts:
//   quota      — max length of one stored value (simulated full storage)
//   deviceKey  — preset "db-wallet:device" (stable device identity)
//   storage    — reuse an existing storage (two tabs / two loads of one browser)
//   document   — replace the document stub (e.g. tests/fake-dom.js)
//   files      — module list, defaults to DEFAULT_FILES
function makeEnv(opts = {}) {
  const alerts = [];
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
    location: { hash: "", href: "https://example.invalid/wallet.html" },
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
    addEventListener() {},
    history: { replaceState() {} },
  };
  win.window = win;
  win.globalThis = win;
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

module.exports = { makeEnv, makeStorage, plain, REPO };
