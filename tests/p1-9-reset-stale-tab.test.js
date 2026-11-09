// P1.9: a stale second tab must not undo or pollute a reset done in another tab.
// Two "tabs" = two module instances (makeEnv) over one shared localStorage.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, makeStorage, plain } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

function twoTabs() {
  const storage = makeStorage();
  const tabA = makeEnv({ storage, deviceKey: "devA" });
  const tabB = makeEnv({ storage });
  return { storage, tabA, tabB };
}

function bookTwoThenOpenBoth(tabA, tabB) {
  const SA = tabA.dbWalletStorage;
  const walletA = SA.loadWallet("dora");
  assert.equal(
    SA.appendEvents(walletA, [SA.newEvent(walletA, "d", 1), SA.newEvent(walletA, "d", 1)]),
    true,
  );
  const walletB = tabB.dbWalletStorage.loadWallet("dora");
  assert.equal(walletB.events.length, 2);
  assert.equal(walletB.walletId, walletA.walletId);
  return { walletA, walletB, oldWalletId: walletA.walletId };
}

function persisted(storage) {
  return JSON.parse(storage.getItem("db-wallet:dora"));
}

test("reset in tab A, stale tab B books: reset stays, B's save is refused", () => {
  const { storage, tabA, tabB } = twoTabs();
  const { walletA, walletB, oldWalletId } = bookTwoThenOpenBoth(tabA, tabB);
  const { ctx, state } = makeActionsCtx(tabA, walletA);
  tabA.dbWalletActions.resetWallet(ctx);
  const newWalletId = state.wallet.walletId;
  assert.notEqual(newWalletId, oldWalletId);

  const SB = tabB.dbWalletStorage;
  const ok = SB.appendEvents(walletB, [SB.newEvent(walletB, "d", 1)]);
  assert.equal(ok, false, "stale tab B must not save over the reset wallet");
  assert.equal(walletB.events.length, 2, "appendEvents rolls back B's booking");

  const after = persisted(storage);
  assert.equal(after.walletId, newWalletId);
  assert.equal(after.events.length, 0, "old events must not come back");
});

test("stale tab B plain saveWallet after reset: false, one German message", () => {
  const { storage, tabA, tabB } = twoTabs();
  const { walletA, walletB } = bookTwoThenOpenBoth(tabA, tabB);
  const { ctx, state } = makeActionsCtx(tabA, walletA);
  tabA.dbWalletActions.resetWallet(ctx);

  const SB = tabB.dbWalletStorage;
  assert.equal(SB.saveWallet(walletB), false);
  assert.equal(SB.saveWallet(walletB), false);
  assert.equal(tabB._alerts.length, 1, plain(tabB._alerts).join(" | "));
  assert.match(tabB._alerts[0], /anderen Tab zurückgesetzt/);
  assert.match(tabB._alerts[0], /neu laden/);

  // Tab A keeps working on the reset wallet.
  const SA = tabA.dbWalletStorage;
  const next = state.wallet;
  assert.equal(SA.appendEvents(next, [SA.newEvent(next, "d", 1)]), true);
  const after = persisted(storage);
  assert.equal(after.walletId, next.walletId);
  assert.equal(after.events.length, 1);
});

test("same walletId: two-tab reconcile still unions both tabs' bookings", () => {
  const { storage, tabA, tabB } = twoTabs();
  const { walletA, walletB } = bookTwoThenOpenBoth(tabA, tabB);
  const SA = tabA.dbWalletStorage;
  const SB = tabB.dbWalletStorage;
  assert.equal(SA.appendEvents(walletA, [SA.newEvent(walletA, "d", 1)]), true);
  assert.equal(SB.appendEvents(walletB, [SB.newEvent(walletB, "g", 5)]), true);
  const after = persisted(storage);
  assert.equal(after.events.length, 4);
  assert.equal(new Set(after.events.map((e) => e.id)).size, 4);
  assert.equal(tabB._alerts.length, 0);
});

test("legacy wallet without walletId stays saveable", () => {
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
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("old");
  assert.ok(wallet.walletId, "loadWallet assigns a walletId in memory");
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
  const after = JSON.parse(storage.getItem("db-wallet:old"));
  assert.equal(after.events.length, 2);
  assert.equal(after.walletId, wallet.walletId);
  assert.equal(w._alerts.length, 0);
});

test("deleted and re-created wallet under the same name: stale tab can't merge in", () => {
  const { storage, tabA, tabB } = twoTabs();
  const { walletB } = bookTwoThenOpenBoth(tabA, tabB);
  // Tab A deletes the wallet (index.html) and creates a new one under the name.
  storage.removeItem("db-wallet:dora");
  const SA = tabA.dbWalletStorage;
  const fresh = SA.loadWallet("dora");
  assert.equal(SA.appendEvents(fresh, [SA.newEvent(fresh, "g", 3)]), true);

  assert.equal(tabB.dbWalletStorage.saveWallet(walletB), false);
  const after = persisted(storage);
  assert.equal(after.walletId, fresh.walletId);
  assert.equal(after.events.length, 1);
});

test("allowWalletIdChange: an intentional walletId switch may overwrite", () => {
  const { storage, tabA } = twoTabs();
  const S = tabA.dbWalletStorage;
  const wallet = S.loadWallet("dora");
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
  const replacement = {
    userId: "dora",
    walletId: tabA.dbWalletHelpers.randomWalletId(),
    v: 2,
    seq: {},
    events: [],
    actionCodes: [],
  };
  assert.equal(S.saveWallet(replacement, { allowWalletIdChange: true }), true);
  const after = persisted(storage);
  assert.equal(after.walletId, replacement.walletId);
  assert.equal(after.events.length, 0);
});
