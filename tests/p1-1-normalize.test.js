// P1.1: event normalization in one place, amount ceiling (plan Anhang A2/A3).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

const TODO = { todo: "P1.1" };

// What wallet-ui.js does on every open.
function reopen(S, userId, times) {
  let wallet;
  for (let i = 0; i < times; i++) {
    wallet = S.loadWallet(userId);
    S.ensureDeviceSeq(wallet);
    S.saveWallet(wallet);
  }
  return S.loadWallet(userId);
}

test("A2: an amount above 1e9 does not multiply on reopen", TODO, () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("bob");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 2000000000)]);
  const after = reopen(S, "bob", 3);
  assert.equal(after.events.length, 1);
  assert.equal(after.events[0].n, w.dbWalletHelpers.MAX_EVENT_AMOUNT);
});

test("A2b: a second booking in the same session after a clamped one", TODO, () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("bob");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 2000000000)]);
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  assert.equal(reopen(S, "bob", 2).events.length, 2);
});

test("A3: imported non-normalized events stay at 3 across reopens", TODO, () => {
  const w = makeEnv({ deviceKey: "devB" });
  const S = w.dbWalletStorage;
  const I = w.dbWalletImportV2;
  const built = I.buildImportedWallet({
    userId: "bob",
    walletId: "AAAAAAAAAAAAAAAA",
    v: 2,
    events: [
      { id: "devA.1", t: "d", ts: 1700000000000 }, // no n
      { id: "devA.2", t: "d", n: "3", ts: 1700000060000 }, // n as string
      { id: "devA.3", t: "p", n: 1, ts: 1700000120000 }, // pay with n
    ],
  });
  S.ensureDeviceSeq(built.wallet);
  S.saveWallet(built.wallet);
  const counts = [];
  for (let i = 0; i < 4; i++) counts.push(reopen(S, built.userId, 1).events.length);
  assert.deepEqual(counts, [3, 3, 3, 3]);
  const evs = S.loadWallet(built.userId).events;
  assert.equal(evs.find((e) => e.id === "devA.1").n, 1);
  assert.equal(evs.find((e) => e.id === "devA.2").n, 3);
  assert.equal("n" in evs.find((e) => e.id === "devA.3"), false);
});

test("import keeps only whitelisted event fields", TODO, () => {
  const w = makeEnv({ deviceKey: "devB" });
  const I = w.dbWalletImportV2;
  const built = I.buildImportedWallet({
    userId: "bob",
    walletId: "AAAAAAAAAAAAAAAA",
    v: 2,
    events: [{ id: "devA.1", t: "d", n: 1, ts: 1700000000000, evil: "x", big: "y".repeat(100) }],
  });
  const ev = built.wallet.events[0];
  assert.deepEqual(Object.keys(ev).sort(), ["id", "n", "t", "ts"]);
});

test("collision on a FOREIGN device id: persisted wins, no re-mint", TODO, () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const H = w.dbWalletHelpers;
  H.safeLocalStorageSetItem(
    "db-wallet:bob",
    JSON.stringify({
      userId: "bob", walletId: "AAAAAAAAAAAAAAAA", v: 2, seq: {},
      events: [{ id: "devB.1", t: "d", n: 1, ts: 1000 }],
      actionCodes: [], devices: [],
    }),
  );
  const stale = {
    userId: "bob", walletId: "AAAAAAAAAAAAAAAA", v: 2, seq: {},
    events: [{ id: "devB.1", t: "d", n: 2, ts: 1000 }],
    actionCodes: [], devices: [],
  };
  assert.equal(S.saveWallet(stale), true);
  const evs = S.loadWallet("bob").events;
  assert.equal(evs.length, 1);
  assert.equal(evs[0].id, "devB.1");
  assert.equal(evs[0].n, 1);
});

test("normalizeAmount caps at MAX_EVENT_AMOUNT", TODO, () => {
  const w = makeEnv();
  const AC = w.dbWalletActionCodes;
  const H = w.dbWalletHelpers;
  assert.equal(H.MAX_EVENT_AMOUNT, 1000000000);
  assert.equal(AC.normalizeAmount("100000000000000000000"), H.MAX_EVENT_AMOUNT);
  assert.equal(AC.normalizeAmount(1e20), H.MAX_EVENT_AMOUNT);
});

test("action code with amount 1e20: capped, export still works", TODO, () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const I = w.dbWalletImportV2;
  const wallet = S.loadWallet("anna");
  wallet.actionCodes.push(
    AC.buildActionCode({ type: "g", amount: "100000000000000000000", label: "X" }),
  );
  S.saveWallet(wallet);
  const loaded = S.loadWallet("anna");
  assert.equal(loaded.actionCodes[0].amount, w.dbWalletHelpers.MAX_EVENT_AMOUNT);
  const decoded = I.decodeImportV2Bytes(I.encodeImportV2Bytes(loaded, null));
  assert.equal(decoded.actionCodes[0].amount, w.dbWalletHelpers.MAX_EVENT_AMOUNT);
});

test("bookCredit and editEntry cap the amount", TODO, () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const MAX = w.dbWalletHelpers.MAX_EVENT_AMOUNT;
  const wallet = S.loadWallet("anna");
  const { ctx } = makeActionsCtx(w, wallet, { prompts: ["5000000000"] });
  w.dbWalletActions.bookCredit(ctx);
  let evs = S.loadWallet("anna").events;
  assert.equal(evs.length, 1);
  assert.equal(evs[0].n, MAX);

  const old = S.newEvent(wallet, "d", 1);
  old.ts = Date.now() - 86400000;
  S.appendEvents(wallet, [old]);
  const date = w.dbWalletSummary.dateStrFromTimestamp(old.ts);
  const e = makeActionsCtx(w, wallet, { deleteRange: "1", prompts: [date, "7000000000"] });
  w.dbWalletActions.editEntry(e.ctx);
  evs = S.loadWallet("anna").events;
  const repl = evs.find((x) => x.supersedes === old.id);
  assert.ok(repl, "replacement written");
  assert.equal(repl.n, MAX);
});
