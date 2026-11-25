// "QR antippen = als PNG speichern" worked only by pointer: the canvases
// were not focusable. The export QR and every action-code QR are now
// buttons for the keyboard too (tabindex 0, role "button", a name that says
// what they do), and Enter or Space saves the PNG.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO, settle, waitFor } = require("./harness");
const { bootWalletPage } = require("./wallet-page");
const { findAll } = require("./fake-dom");

const HTML = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
function seedCode(e) {
  const S = e.dbWalletStorage;
  const AC = e.dbWalletActionCodes;
  const x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 1)]);
  S.saveWallet(AC.createActionCode(S.loadWallet("max"), { scope: "local", type: "d", amount: "2", label: "Zwei" }).wallet);
}

// Every Blob download, by file name; canvases made later hand out a blob.
function trackDownloads(w) {
  const names = [];
  w.dbWalletHelpers.downloadBlob = (blob, name) => names.push(name);
  const orig = w.document.createElement;
  w.document.createElement = (tag) => {
    const el = orig(tag);
    if (String(tag).toLowerCase() === "canvas") el.toBlob = (cb) => cb({});
    return el;
  };
  return names;
}

function key(el, k) {
  let prevented = 0;
  for (const fn of el.listeners.keydown || []) {
    fn({ key: k, target: el, preventDefault: () => prevented++ });
  }
  return prevented;
}

test("wallet.html: the export QR is a focusable button with a name", () => {
  const tag = /<canvas id="qr-canvas"[^>]*>/.exec(HTML)[0];
  assert.match(tag, /\btabindex="0"/);
  assert.match(tag, /\brole="button"/);
  assert.match(tag, /\baria-label="QR-Code als PNG speichern"/);
});

test("export QR: Enter and Space save the PNG, other keys do nothing", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedCode });
  const doc = w.document;
  const names = trackDownloads(w);
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  const canvas = doc.getElementById("qr-canvas");
  assert.equal(key(canvas, "Tab"), 0);
  assert.deepEqual(names, []);
  assert.equal(key(canvas, "Enter"), 1, "default prevented");
  assert.equal(key(canvas, " "), 1, "no page scroll on Space");
  assert.equal(names.length, 2);
  assert.match(names[0], /^db-wallet-max-\d{4}-\d{2}-\d{2}\.png$/);
});

test("action-code QR: a named button; Enter saves the PNG once drawn", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedCode });
  const names = trackDownloads(w);
  const canvas = () =>
    findAll(w.document.getElementById("action-codes-body"), (el) => el.className === "action-code-canvas")[0];
  const c = canvas();
  assert.equal(c.tabIndex, 0);
  assert.equal(c.getAttribute("role"), "button");
  assert.equal(c.getAttribute("aria-label"), "QR-Code „Zwei“ als PNG speichern");
  c.toBlob = (cb) => cb({});
  key(c, "Enter");
  assert.deepEqual(names, [], "nothing to save before the QR is drawn");

  const panel = w.document.getElementById("action-codes-panel");
  panel.open = true;
  panel.dispatch("toggle");
  await settle();
  assert.equal(key(c, "Enter"), 1);
  assert.deepEqual(names, ["db-wallet-max-action-Zwei.png"]);
});
