// Boots wallet.html's scripts (in page order) in the vm harness on a fake page
// DOM with the fake location/history, then runs the DOMContentLoaded handler.
// Skipped: import-preview.js (dialog overlay; without it an import persists
// directly), self-check-loader.js and sw-register.js.
// A <script src> the page appends later (qrcodegen.js on first use) runs in
// the same context on the next turn, then fires onload; `w._scriptLoads` lists
// them, and `opts.failScripts` (a Set of src) fires onerror instead.
const fs = require("fs");
const path = require("path");
const { makeEnv, REPO } = require("./harness");
const { makePageDocument } = require("./fake-dom");

const SKIP = new Set(["import-preview.js", "self-check-loader.js", "sw-register.js"]);

// The page's <script src> files in order, without SKIP.
function pageFiles(html) {
  return Array.from(html.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
    .map((m) => m[1])
    .filter((f) => !SKIP.has(f));
}

const HTML = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
const PAGE_FILES = pageFiles(HTML);

const BASE = "https://example.invalid/wallet.html";

// opts: hash (start fragment, without "#"), storage, deviceKey, seed(w) to
// prepare storage before the boot (runs in a throwaway env on the same storage).
// For another release (scripts/upgrade-check.js; `seed` still runs this repo's
// modules — prepare `storage` yourself instead):
//   root            — directory of wallet.html and the scripts, default REPO;
//   html            — the page text, default <root>/wallet.html;
//   scriptSource(f) — returns the text of script f (the page's scripts and the
//                     ones it appends later), default <root>/<f>.
async function bootWalletPage(opts = {}) {
  const { makeStorage } = require("./harness");
  const root = opts.root || REPO;
  const html =
    typeof opts.html === "string"
      ? opts.html
      : root === REPO
        ? HTML
        : fs.readFileSync(path.join(root, "wallet.html"), "utf8");
  const files = html === HTML ? PAGE_FILES : pageFiles(html);
  const storage = opts.storage || makeStorage();
  if (opts.seed) {
    opts.seed(makeEnv({ storage, deviceKey: opts.deviceKey || "devA" }));
  }
  const document = makePageDocument(html);
  const source = opts.scriptSource;
  const w = makeEnv({
    storage,
    deviceKey: opts.deviceKey || "devA",
    document,
    files: source ? [] : files,
    root,
    url: BASE + (opts.hash ? "#" + opts.hash : ""),
  });
  if (source) for (const f of files) w._eval(source(f), f);
  emulateScriptLoads(w, document.body, opts.failScripts, { root, scriptSource: source });
  // Count wallet switches: every switchToUser ends in updateUidLabel, which
  // writes #uid; count the writes.
  const uid = document.getElementById("uid");
  let uidWrites = 0;
  let uidText = "";
  Object.defineProperty(uid, "textContent", {
    get: () => uidText,
    set: (v) => {
      uidWrites++;
      uidText = String(v);
    },
  });
  w._uidWrites = () => uidWrites;
  await Promise.all(document._fire("DOMContentLoaded"));
  return w;
}

// `from` (optional): { root, scriptSource } as in bootWalletPage.
function emulateScriptLoads(w, parent, failScripts, from) {
  const root = (from && from.root) || REPO;
  const source = from && from.scriptSource;
  w._scriptLoads = [];
  const append = parent.appendChild.bind(parent);
  parent.appendChild = (el) => {
    const r = append(el);
    if (el && el.tagName === "SCRIPT" && el.src) {
      const src = String(el.src);
      w._scriptLoads.push(src);
      setImmediate(() => {
        if (failScripts && failScripts.has(src)) {
          if (typeof el.onerror === "function") el.onerror(new Error("load failed"));
          return;
        }
        w._eval(source ? source(src) : fs.readFileSync(path.join(root, src), "utf8"), src);
        if (typeof el.onload === "function") el.onload();
      });
    }
    return r;
  };
}

// Deliver queued hashchange events and wait for their handlers: wallet-ui.js's
// listener returns the handler's promise (i2: decompression is truly async).
// A handler may queue the next hashchange, so repeat until none is left.
async function flushHashChanges(w) {
  const nav = w._nav;
  for (let i = 0; i < 50; i++) {
    const pending = nav.flush();
    if (!pending.length) return;
    await Promise.all(pending);
  }
  throw new Error("flushHashChanges: the hashchange handlers kept queueing new ones");
}

// Seed for bootWalletPage: wallet "max" with one booking of n drinks; n = 0
// saves it empty.
function seedOpen(n) {
  return (e) => {
    const S = e.dbWalletStorage;
    const x = S.loadWallet("max");
    if (n > 0) S.appendEvents(x, [S.newEvent(x, "d", n)]);
    else S.saveWallet(x);
  };
}

// The text of the page's status line (#status-text, helpers.notify).
const statusText = (w) => w.document.getElementById("status-text").textContent;

module.exports = {
  bootWalletPage,
  flushHashChanges,
  emulateScriptLoads,
  pageFiles,
  seedOpen,
  statusText,
  PAGE_FILES,
  BASE,
};
