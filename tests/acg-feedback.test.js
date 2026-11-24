// Global action codes (`acg:`) opened on wallet.html: a broken or invalid
// code books nothing and says so in the status line (no wallet selection for
// a code that cannot be applied); a valid code on a cold start reports what
// it booked, like one opened while the wallet is already open.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");
const { plain } = require("./harness");
const { findAll } = require("./fake-dom");

// "acg:" + base64url("garbage"): not JSON, so decodeGlobalActionHash → null.
const BROKEN = "acg:Z2FyYmFnZQ";

function seedWallets(...ids) {
  return (e) => {
    const S = e.dbWalletStorage;
    for (const id of ids) S.saveWallet(S.loadWallet(id));
  };
}

function status(w) {
  const line = w.document.getElementById("status-line");
  return {
    text: w.document.getElementById("status-text").textContent,
    visible: line.classList.contains("is-visible"),
    error: line.classList.contains("is-error"),
  };
}

// The boot used to wait for a wallet choice on an invalid code; a boot that
// does not finish fails the test instead of hanging it.
async function boot(opts) {
  let timer;
  const hang = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("boot waits for a wallet selection")), 500);
  });
  try {
    return await Promise.race([bootWalletPage(opts), hang]);
  } finally {
    clearTimeout(timer);
  }
}

const events = (w, id) => w.dbWalletStorage.loadWallet(id).events.length;
const hashOf = (w) => w.location.hash.slice(1);

test("invalid acg: with two wallets: no wallet choice, an error, nothing booked", async () => {
  const w = await boot({ hash: BROKEN, seed: seedWallets("anna", "berta") });
  assert.equal(w.document.getElementById("global-action-wallet-select"), null, "no wallet choice");
  const s = status(w);
  assert.match(s.text, /Action Code ungültig/);
  assert.ok(s.visible && s.error);
  assert.equal(events(w, "anna"), 0);
  assert.equal(events(w, "berta"), 0);
  assert.doesNotMatch(hashOf(w), /^acg:/, "the broken code leaves the address bar");
  assert.deepEqual(plain(w._alerts), []);
});

test("invalid acg: with two wallets (none used in this tab) lists them", async () => {
  const w = await boot({ hash: BROKEN, seed: seedWallets("anna", "berta") });
  assert.equal(w.document.body.dataset.noWallet, "1");
  const msg = w.document.getElementById("global-action-message");
  assert.equal(msg.dataset.mode, "no-wallet");
  const links = findAll(msg, (el) => el.tagName === "A").map((a) => a.href);
  assert.deepEqual(links, ["wallet.html#anna", "wallet.html#berta", "index.html"]);
  assert.equal(hashOf(w), "");
});

test("invalid acg: with one wallet opens it and reports the error", async () => {
  const w = await boot({ hash: BROKEN, seed: seedWallets("anna") });
  assert.equal(w.dbWalletUi.getCurrentUserId(), "anna");
  assert.equal(hashOf(w), "anna");
  const s = status(w);
  assert.match(s.text, /Action Code ungültig/);
  assert.ok(s.error);
  assert.equal(events(w, "anna"), 0);
});

test("buildGlobalActionPreview: no made-up booking for an invalid payload", async () => {
  const w = await boot({ hash: "anna", seed: seedWallets("anna") });
  assert.equal(w.dbWalletHashActions.buildGlobalActionPreview(null), null);
  const res = await w.dbWalletHashActions.awaitGlobalActionWalletSelection({
    userIds: ["anna", "berta"],
    payload: null,
  });
  assert.equal(res.action, "cancel");
  assert.equal(w.document.getElementById("global-action-wallet-select"), null);
});

test("broken acg: link while a wallet is open: an error, the hash goes back", async () => {
  const w = await boot({ hash: "anna", seed: seedWallets("anna") });
  w.location.hash = BROKEN;
  await flushHashChanges(w);
  const s = status(w);
  assert.match(s.text, /Action Code ungültig/);
  assert.ok(s.visible && s.error);
  assert.equal(hashOf(w), "anna");
  assert.equal(w.document.getElementById("global-action-message"), null, "no no-wallet notice");
  assert.equal(w.document.body.dataset.noWallet, undefined);
  assert.equal(events(w, "anna"), 0);
});
