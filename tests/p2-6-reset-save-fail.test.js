// P2.6: stragglers from P1.6/P1.9/P2.1.
//  - resetWallet must not treat a failed save as a done reset (the stored
//    wallet must survive, the tab keeps the old state, one clear message).
//  - Two tabs that each mint a fresh walletId for a never-saved wallet must
//    not trip the P1.9 stale-tab guard against each other.
//  - index.html: a declined import prompt drops the hash without a new
//    history entry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, plain, REPO } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");
const { makePageDocument } = require("./fake-dom");

function persisted(storage, userId) {
  const raw = storage.getItem("db-wallet:" + userId);
  return raw ? JSON.parse(raw) : null;
}

test("reset with full storage: stored wallet survives, tab keeps old state, message", () => {
  const storage = makeStorage();
  const w = makeEnv({ storage, deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("dora");
  assert.equal(
    S.appendEvents(wallet, [S.newEvent(wallet, "d", 1), S.newEvent(wallet, "d", 1)]),
    true,
  );
  const oldWalletId = wallet.walletId;
  storage.quota = 10; // storage is now full: every write throws

  const { ctx, state } = makeActionsCtx(w, wallet);
  w.dbWalletActions.resetWallet(ctx);

  assert.equal(state.wallet, wallet, "the tab keeps the old wallet object");
  assert.equal(state.wallet.walletId, oldWalletId);
  assert.equal(state.wallet.events.length, 2);
  const after = persisted(storage, "dora");
  assert.ok(after, "the stored wallet must not be deleted by a failed reset");
  assert.equal(after.walletId, oldWalletId);
  assert.equal(after.events.length, 2);
  const msgs = plain(state.alerts).concat(plain(w._alerts));
  assert.equal(msgs.length, 1, msgs.join(" | "));
  assert.match(msgs[0], /Zurücksetzen fehlgeschlagen/);
  assert.match(msgs[0], /unverändert/);
});

test("reset of a legacy wallet without walletId does not merge old events back", () => {
  const storage = makeStorage();
  storage.setItem(
    "db-wallet:old",
    JSON.stringify({
      userId: "old",
      v: 2,
      seq: {},
      events: [{ id: "devA.1", t: "d", n: 1, ts: 1700000000000 }],
    }),
  );
  const w = makeEnv({ storage, deviceKey: "devA" });
  const wallet = w.dbWalletStorage.loadWallet("old");
  const { ctx, state } = makeActionsCtx(w, wallet);
  w.dbWalletActions.resetWallet(ctx);
  const after = persisted(storage, "old");
  assert.equal(after.events.length, 0);
  assert.equal(after.walletId, state.wallet.walletId);
});

test("two tabs open a never-saved wallet: both bookings are saved", () => {
  const storage = makeStorage();
  const w = makeEnv({ storage, deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const tabA = S.loadWallet("bob");
  const tabB = S.loadWallet("bob");
  assert.notEqual(tabA.walletId, tabB.walletId, "each load mints its own walletId");
  assert.equal(S.appendEvents(tabA, [S.newEvent(tabA, "d", 1)]), true);
  assert.equal(S.appendEvents(tabB, [S.newEvent(tabB, "g", 5)]), true);
  const after = persisted(storage, "bob");
  assert.equal(after.events.length, 2);
  assert.equal(after.walletId, tabA.walletId, "the first saved walletId wins");
  assert.equal(tabB.walletId, tabA.walletId, "tab B adopted it");
  assert.equal(w._alerts.length, 0, plain(w._alerts).join(" | "));
});

test("two tabs open a legacy wallet without walletId: both bookings are saved", () => {
  const storage = makeStorage();
  storage.setItem(
    "db-wallet:old",
    JSON.stringify({
      userId: "old",
      v: 2,
      seq: {},
      events: [{ id: "devA.1", t: "d", n: 1, ts: 1700000000000 }],
    }),
  );
  const tab1 = makeEnv({ storage, deviceKey: "devA" });
  const tab2 = makeEnv({ storage });
  const A = tab1.dbWalletStorage.loadWallet("old");
  const B = tab2.dbWalletStorage.loadWallet("old");
  assert.equal(tab1.dbWalletStorage.appendEvents(A, [tab1.dbWalletStorage.newEvent(A, "d", 1)]), true);
  assert.equal(tab2.dbWalletStorage.appendEvents(B, [tab2.dbWalletStorage.newEvent(B, "g", 5)]), true);
  const after = persisted(storage, "old");
  assert.equal(after.events.length, 3);
  assert.equal(new Set(after.events.map((e) => e.id)).size, 3);
  assert.equal(tab2._alerts.length, 0);
});

test("legacy wallet open in a stale tab, reset elsewhere: stale save still refused", () => {
  const storage = makeStorage();
  storage.setItem(
    "db-wallet:old",
    JSON.stringify({
      userId: "old",
      v: 2,
      seq: {},
      events: [{ id: "devA.1", t: "d", n: 1, ts: 1700000000000 }],
    }),
  );
  const tab1 = makeEnv({ storage, deviceKey: "devA" });
  const tab2 = makeEnv({ storage });
  const A = tab1.dbWalletStorage.loadWallet("old");
  const B = tab2.dbWalletStorage.loadWallet("old");
  const { ctx, state } = makeActionsCtx(tab1, A);
  tab1.dbWalletActions.resetWallet(ctx);
  const SB = tab2.dbWalletStorage;
  assert.equal(SB.appendEvents(B, [SB.newEvent(B, "d", 1)]), false);
  const after = persisted(storage, "old");
  assert.equal(after.walletId, state.wallet.walletId);
  assert.equal(after.events.length, 0, "the old legacy event must not come back");
});

// --- index.html: declined import prompt ------------------------------------

const INDEX_HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const INDEX_SKIP = new Set(["theme.js", "import-preview.js", "sw-register.js"]);
const INDEX_FILES = Array.from(INDEX_HTML.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
  .map((m) => m[1])
  .filter((f) => !INDEX_SKIP.has(f));

test("index.html: declined import prompt clears the hash without a history entry", async () => {
  const document = makePageDocument(INDEX_HTML);
  const w = makeEnv({
    deviceKey: "devA",
    document,
    files: INDEX_FILES,
    url: "https://example.invalid/index.html#i2:AAAA",
  });
  const confirms = [];
  w.confirm = (m) => {
    confirms.push(String(m));
    return false;
  };
  await Promise.all(document._fire("DOMContentLoaded"));
  assert.equal(confirms.length, 1, "the import prompt was shown");
  assert.equal(w.location.hash, "");
  assert.equal(w.history.length, 1, "no extra history entry: " + w._nav.entries.join(" "));
  assert.equal(w._nav.pageLoads.length, 0);
});
