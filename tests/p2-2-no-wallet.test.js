// P2.2: wallet.html without a usable hash is no dead end — it shows a link to
// the start page and the wallets on this device (E3: no auto-open), a broken
// import link ends in the same state, and a hash set afterwards opens a wallet.
// Visibility itself is CSS (body[data-no-wallet="1"] hides everything except
// #global-action-message); here we check the flag and the panel's content.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");
const { findAll } = require("./fake-dom");

function seedTwo(e) {
  const S = e.dbWalletStorage;
  S.saveWallet(S.loadWallet("anna"));
  S.saveWallet(S.loadWallet("berta"));
}

function panel(w) {
  return w.document.getElementById("global-action-message");
}

function links(w) {
  const p = panel(w);
  return p ? findAll(p, (el) => el.tagName === "A").map((a) => a.href) : [];
}

test("no hash: no-wallet state with start-page link and the wallet list", async () => {
  const w = await bootWalletPage({ seed: seedTwo });
  assert.equal(w.document.body.dataset.noWallet, "1");
  const hrefs = links(w);
  assert.ok(hrefs.includes("index.html"), hrefs.join(" "));
  assert.ok(hrefs.includes("wallet.html#anna"), hrefs.join(" "));
  assert.ok(hrefs.includes("wallet.html#berta"), hrefs.join(" "));
  assert.equal(w.dbWalletUi, undefined, "no wallet is opened automatically (E3)");
});

test("no hash and no wallets: still a link to the start page", async () => {
  const w = await bootWalletPage({});
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.deepEqual(links(w), ["index.html"]);
});

test("broken #i2: link on a cold start ends in the no-wallet state", async () => {
  const w = await bootWalletPage({ seed: seedTwo, hash: "i2:AAAA" });
  await flushHashChanges(w);
  assert.ok(w._alerts.length >= 1, "the import error is reported");
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.ok(links(w).includes("wallet.html#anna"), links(w).join(" "));
});

test("a hash set after the no-wallet state opens that wallet", async () => {
  const w = await bootWalletPage({ seed: seedTwo });
  w.location.hash = "#anna";
  await flushHashChanges(w);
  // The no-wallet boot has no wallet UI wired; it reloads into the full boot.
  assert.deepEqual(w._nav.pageLoads, ["https://example.invalid/wallet.html#anna"]);
});
