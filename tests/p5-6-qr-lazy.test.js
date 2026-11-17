// P5.6: wallet.html no longer loads qrcodegen.js (35 KB) on every visit. The
// export QR and the action-code panel load it on first use
// (helpers.loadQrLibrary), and the panel draws its QR cards only while its
// <details> is open. The file stays precached and deployed (offline).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO } = require("./harness");
const { bootWalletPage } = require("./wallet-page");
const { findAll } = require("./fake-dom");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const tick = () => new Promise((r) => setImmediate(r));
async function settle() {
  for (let i = 0; i < 6; i++) await tick();
}

function seedCodes(e) {
  const S = e.dbWalletStorage;
  const AC = e.dbWalletActionCodes;
  let x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 1)]);
  x = AC.createActionCode(S.loadWallet("max"), { scope: "local", type: "d", amount: "2", label: "Zwei" }).wallet;
  x = AC.createActionCode(x, { scope: "global", type: "g", amount: "5", label: "Fünf" }).wallet;
  S.saveWallet(x);
}

const canvases = (w) =>
  findAll(w.document.getElementById("action-codes-body"), (el) => el.className === "action-code-canvas");

function openPanel(w) {
  const panel = w.document.getElementById("action-codes-panel");
  panel.open = true;
  panel.dispatch("toggle");
}

// Deployed via the `./*.js` glob; p3-4 checks APP_SHELL against the allowlist.
test("wallet.html has no qrcodegen.js tag; the file stays precached", () => {
  assert.doesNotMatch(read("wallet.html"), /qrcodegen\.js/);
  assert.match(read("service-worker.js"), /"\.\/qrcodegen\.js"/);
  assert.match(read("wallet-helpers.js"), /QR_LIBRARY_SRC = "qrcodegen\.js"/);
});

test("booting the wallet loads no QR library and draws no action-code QR", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedCodes });
  await settle();
  assert.equal(w.qrcodegen, undefined);
  assert.deepEqual(w._scriptLoads, []);
  const cs = canvases(w);
  assert.equal(cs.length, 2, "both cards are there");
  assert.ok(cs.every((c) => c.width === 1), "but not drawn");
});

test("opening the panel loads qrcodegen.js once and draws every card", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedCodes });
  openPanel(w);
  openPanel(w);
  await settle();
  assert.deepEqual(w._scriptLoads, ["qrcodegen.js"]);
  assert.ok(w.qrcodegen && w.qrcodegen.QrCode);
  assert.ok(canvases(w).every((c) => c.width > 100), "drawn at scale 6");
  // A later re-render with the panel open draws at once (library cached).
  w.document.getElementById("btn-drink").click();
  await settle();
  assert.ok(canvases(w).every((c) => c.width > 100));
  assert.deepEqual(w._scriptLoads, ["qrcodegen.js"]);
});

test("the export QR loads the library on first use", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedCodes });
  const doc = w.document;
  doc.getElementById("btn-export").click();
  doc.getElementById("btn-export-link-qr").click();
  for (let i = 0; i < 200 && !doc.getElementById("qr-url").value; i++) await tick();
  assert.match(doc.getElementById("qr-url").value, /#i2:/);
  assert.deepEqual(w._scriptLoads, ["qrcodegen.js"]);
  assert.ok(doc.getElementById("qr-canvas").width > 100);
  // The panel reuses it.
  openPanel(w);
  await settle();
  assert.deepEqual(w._scriptLoads, ["qrcodegen.js"]);
  assert.ok(canvases(w).every((c) => c.width > 100));
});

test("a failed load shows the link and an error per card; the next try loads again", async () => {
  const fail = new Set(["qrcodegen.js"]);
  const w = await bootWalletPage({ hash: "max", seed: seedCodes, failScripts: fail });
  openPanel(w);
  await settle();
  const body = w.document.getElementById("action-codes-body");
  const errors = findAll(body, (el) => el.className === "action-code-error");
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.textContent.includes("QR-Code-Generator fehlt")));
  assert.ok(canvases(w).every((c) => c.hidden));
  const urls = findAll(body, (el) => el.className === "action-code-url");
  assert.ok(urls.every((u) => /#acg?:/.test(u.value)), "the links still work");
  // Online again: the export tries once more and succeeds.
  fail.clear();
  const doc = w.document;
  doc.getElementById("btn-export").click();
  doc.getElementById("btn-export-link-qr").click();
  for (let i = 0; i < 200 && !doc.getElementById("qr-url").value; i++) await tick();
  assert.deepEqual(w._scriptLoads, ["qrcodegen.js", "qrcodegen.js"]);
  assert.ok(doc.getElementById("qr-canvas").width > 100);
});
