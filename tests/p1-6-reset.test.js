// P1.6: reset never re-issues an old event id; reset = new wallet (E2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");


function bookTwoAndReset(w) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("dora");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1), S.newEvent(wallet, "d", 1)]);
  const before = wallet.events.map((e) => e.id);
  const oldWalletId = wallet.walletId;
  const oldExport = w.dbWalletImportV2.encodeImportV2Bytes(wallet, null);
  const { ctx, state } = makeActionsCtx(w, wallet);
  w.dbWalletActions.resetWallet(ctx);
  return { before, oldWalletId, oldExport, state };
}

test("A6: the first booking after reset reuses no earlier id", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const { before, state } = bookTwoAndReset(w);
  const next = state.wallet;
  assert.equal(next.events.length, 0);
  S.appendEvents(next, [S.newEvent(next, "d", 1)]);
  const reloaded = S.loadWallet("dora");
  assert.equal(reloaded.events.length, 1);
  assert.ok(!before.includes(reloaded.events[0].id), `reused ${reloaded.events[0].id}`);
});

test("reset gives the wallet a new walletId", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const { oldWalletId, state } = bookTwoAndReset(w);
  assert.notEqual(state.wallet.walletId, oldWalletId);
  assert.equal(w.dbWalletStorage.loadWallet("dora").walletId, state.wallet.walletId);
});

test("importing a pre-reset export does not land in the reset wallet", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const I = w.dbWalletImportV2;
  const { oldExport } = bookTwoAndReset(w);
  const built = I.buildImportedWallet(I.decodeImportV2Bytes(oldExport));
  assert.notEqual(built.userId, "dora");
  S.saveWallet(built.wallet);
  assert.equal(S.loadWallet("dora").events.length, 0);
});

test("reset keeps the userId and clears codes (baseline)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const { state } = bookTwoAndReset(w);
  assert.equal(state.wallet.userId, "dora");
  assert.equal(state.wallet.actionCodes.length, 0);
  assert.equal(w.dbWalletStorage.loadWallet("dora").events.length, 0);
});
