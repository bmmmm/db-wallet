// Boots wallet.html's scripts (in page order) in the vm harness on a fake page
// DOM with the fake location/history, then runs the DOMContentLoaded handler.
// Skipped: theme.js / import-preview.js (dialog overlay; without it an import
// persists directly), self-check-loader.js and sw-register.js.
const fs = require("fs");
const path = require("path");
const { makeEnv, REPO } = require("./harness");
const { makePageDocument } = require("./fake-dom");

const SKIP = new Set(["theme.js", "import-preview.js", "self-check-loader.js", "sw-register.js"]);
const HTML = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
const PAGE_FILES = Array.from(HTML.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
  .map((m) => m[1])
  .filter((f) => !SKIP.has(f));

const BASE = "https://example.invalid/wallet.html";

// opts: hash (start fragment, without "#"), storage, deviceKey, seed(w) to
// prepare storage before the boot (runs in a throwaway env on the same storage).
async function bootWalletPage(opts = {}) {
  const { makeStorage } = require("./harness");
  const storage = opts.storage || makeStorage();
  if (opts.seed) {
    opts.seed(makeEnv({ storage, deviceKey: opts.deviceKey || "devA" }));
  }
  const document = makePageDocument(HTML);
  const w = makeEnv({
    storage,
    deviceKey: opts.deviceKey || "devA",
    document,
    files: PAGE_FILES,
    url: BASE + (opts.hash ? "#" + opts.hash : ""),
  });
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

module.exports = { bootWalletPage, flushHashChanges, PAGE_FILES, BASE };
