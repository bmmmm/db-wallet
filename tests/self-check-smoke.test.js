// Anti-rot for self-check.js, the browser smoke test: it runs on the Node page
// fake, loaded the way wallet.html loads it (self-check-loader.js injects it on
// the first run()). No check may throw or fail against today's API; only what
// needs a real browser (Service Worker, Cache Storage) counts as skipped.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, plain, waitFor, REPO } = require("./harness");
const { bootWalletPage, seedOpen, statusText } = require("./wallet-page");
const { findAll } = require("./fake-dom");

const LOADER = fs.readFileSync(path.join(REPO, "self-check-loader.js"), "utf8");
const BROWSER_ONLY = ["Service Worker active", "Service Worker cache covers the page"];

// The page fake has no layout. The page-state check asks for computed styles;
// this one knows `hidden`, an inline display and the no-wallet rule of
// style.css (every <body> child but the notice, the status line and dialogs —
// makePageDocument puts every element right under <body>).
function fakeComputedStyle(w) {
  const body = w.document.body;
  const kept = new Set(["global-action-message", "status-line"]);
  return (el) => {
    let display = "block";
    if (el.hidden) display = "none";
    else if (el.style.display) display = el.style.display;
    else if (body.dataset.noWallet === "1" && el.parentNode === body && !kept.has(el.id) && el.tagName !== "DIALOG") {
      display = "none";
    }
    return { display };
  };
}

const snapshot = (storage) => {
  const out = {};
  for (let i = 0; i < storage.length; i++) out[storage.key(i)] = storage.getItem(storage.key(i));
  return out;
};

// Runs the self-check on a booted page and checks what holds on every page:
// no error, no failed check, exactly the browser-only ones skipped, and the
// run leaves storage, URL, history and the status line as it found them.
async function runSelfCheck(w, storage) {
  w.getComputedStyle = fakeComputedStyle(w);
  const before = {
    storage: snapshot(storage),
    href: w.location.href,
    entries: w._nav.entries.slice(),
    status: statusText(w),
  };
  w._eval(LOADER, "self-check-loader.js");
  const res = plain(await w.dbWalletSelfCheck.run({ quiet: true }));
  assert.deepEqual(res.errors, []);
  for (const c of res.checks) assert.ok(c.ok, `${c.name}: ${c.info}`);
  assert.equal(res.ok, true);
  assert.deepEqual(res.checks.filter((c) => c.skipped).map((c) => c.name), BROWSER_ONLY);
  assert.deepEqual(snapshot(storage), before.storage, "no selfcheck wallet or registry entry left");
  assert.equal(w.location.href, before.href);
  assert.deepEqual(w._nav.entries, before.entries);
  assert.equal(statusText(w), before.status);
  assert.ok(w._scriptLoads.includes("self-check.js"));
  return res;
}

const pageState = (res) => res.checks.find((c) => c.name === "page state matches the CSS").info;

test("open wallet: every check passes, only the Service Worker ones are skipped", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(2) });
  const res = await runSelfCheck(w, storage);
  assert.equal(pageState(res), "wallet max");
  assert.deepEqual(w._scriptLoads, ["self-check.js", "qrcodegen.js"], "QR library loaded on demand");
});

test("no wallet: the page state check sees the notice with its way out", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ storage });
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.equal(pageState(await runSelfCheck(w, storage)), "no wallet");
});

test("acg: wallet choice open: the page state check sees the choice", async () => {
  const storage = makeStorage();
  let w;
  const seed = (e) => {
    for (const id of ["anna", "berta"]) e.dbWalletStorage.saveWallet(e.dbWalletStorage.loadWallet(id));
  };
  const acg = makeEnv().dbWalletActionCodes.encodeGlobalActionHash({ v: 1, t: "d", n: 1, l: "Eins" });
  const booting = bootWalletPage({ hash: acg, storage, seed, beforeBoot: (env) => (w = env) });
  const choice = await waitFor(() => w && w.document.getElementById("global-action-wallet-select"), "the wallet choice");
  assert.equal(pageState(await runSelfCheck(w, storage)), "acg wallet choice");
  findAll(choice, (el) => el.className === "global-action-card")[0].click();
  await booting;
});

test("a missing app API fails its check instead of being skipped", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(1) });
  w.getComputedStyle = fakeComputedStyle(w);
  w.dbWalletHelpers.replaceHashSilently = undefined;
  w._eval(LOADER, "self-check-loader.js");
  const res = plain(await w.dbWalletSelfCheck.run({ quiet: true }));
  assert.equal(res.ok, false);
  const failed = res.checks.filter((c) => !c.ok);
  assert.deepEqual(failed.map((c) => c.name), ["replaceHashSilently adds no history entry"]);
  assert.match(failed[0].info, /^threw: /);
  assert.equal(res.errors.length, 1);
});
