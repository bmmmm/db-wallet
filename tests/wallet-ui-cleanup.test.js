// wallet.html after the cleanup: what was removed stays removed, and what
// replaced it works. The classic #import: export button is gone (the QR
// export's compact link covers it); the raw view shows only the open wallet
// (the start page keeps "Alle Raw-Daten anzeigen").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage } = require("./wallet-page");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

function seedTwo(e) {
  const S = e.dbWalletStorage;
  for (const id of ["anna", "max"]) {
    const x = S.loadWallet(id);
    S.appendEvents(x, [S.newEvent(x, "d", 1)]);
  }
}

test("no classic export link and no all-wallets raw toggle on wallet.html", () => {
  const html = read("wallet.html");
  assert.doesNotMatch(html, /id="btn-export-link"/);
  assert.doesNotMatch(html, /raw-scope|raw-toggle/);
  assert.doesNotMatch(read("wallet-export-ui.js"), /#import:|btnExportLink\b/);
  assert.doesNotMatch(read("wallet-history-ui.js"), /getAllWallets|rawScope/);
});

test("Raw-Log shows the open wallet only", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedTwo });
  w.document.getElementById("mode-raw").click();
  const raw = JSON.parse(w.document.getElementById("history").textContent);
  assert.equal(raw.userId, "max");
  assert.equal(raw.events.length, 1);
  assert.equal(raw.anna, undefined);
  // A booking refreshes it (the cache is dropped on every change).
  w.document.getElementById("btn-drink").click();
  assert.equal(JSON.parse(w.document.getElementById("history").textContent).events.length, 2);
});
