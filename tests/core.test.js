// Baseline: behavior that is correct today and must stay correct.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

function summary(w, wallet) {
  return plain(w.dbWalletSummary.computeSummary(wallet));
}

test("book drink, pay, credit: balance folds as expected", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("anna");
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 3)]), true);
  let s = summary(w, S.loadWallet("anna"));
  assert.equal(s.total, 3);
  assert.equal(s.unpaid, 3);

  S.appendEvents(wallet, [S.newEvent(wallet, "p")]);
  s = summary(w, S.loadWallet("anna"));
  assert.equal(s.unpaid, 0);

  S.appendEvents(wallet, [S.newEvent(wallet, "g", 5)]);
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 2)]);
  s = summary(w, S.loadWallet("anna"));
  assert.equal(s.credit, 3);
  assert.equal(s.unpaid, 0);
});

test("ids are <deviceKey>.<base36 seq> and strictly increasing", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("anna");
  const evs = [];
  for (let i = 0; i < 12; i++) evs.push(S.newEvent(wallet, "d", 1));
  S.appendEvents(wallet, evs);
  assert.deepEqual(
    plain(evs.map((e) => e.id).slice(8)),
    ["devA.9", "devA.a", "devA.b", "devA.c"],
  );
});

test("undo tombstones the last visible entry (monotonic)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("anna");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 2)]);
  const tomb = S.undoLastEvent(wallet);
  assert.equal(tomb.t, "x");
  assert.equal(tomb.ref, "devA.2");
  const again = S.undoLastEvent(wallet);
  assert.equal(again.ref, "devA.1");
  assert.equal(summary(w, S.loadWallet("anna")).total, 0);
  assert.equal(S.undoLastEvent(S.loadWallet("anna")), null);
});

test("editEntry appends a supersedes replacement, no in-place change", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("anna");
  const ev = S.newEvent(wallet, "d", 2);
  ev.ts = Date.now() - 3 * 86400000;
  S.appendEvents(wallet, [ev]);
  const date = w.dbWalletSummary.dateStrFromTimestamp(ev.ts);
  const { ctx } = makeActionsCtx(w, wallet, {
    deleteRange: "1",
    prompts: [date, "5"],
  });
  w.dbWalletActions.editEntry(ctx);
  const reloaded = S.loadWallet("anna");
  assert.equal(reloaded.events.length, 2);
  const orig = reloaded.events.find((e) => e.id === ev.id);
  assert.equal(orig.n, 2);
  const repl = reloaded.events.find((e) => e.id !== ev.id);
  assert.equal(repl.supersedes, ev.id);
  assert.equal(repl.n, 5);
  assert.equal(summary(w, reloaded).total, 5);
});

test("codec roundtrip: encode -> decode -> buildImportedWallet", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const SA = a.dbWalletStorage;
  const wallet = SA.loadWallet("anna");
  SA.appendEvents(wallet, [SA.newEvent(wallet, "d", 2)]);
  SA.appendEvents(wallet, [SA.newEvent(wallet, "g", 4)]);
  SA.appendEvents(wallet, [SA.newEvent(wallet, "p")]);
  SA.undoLastEvent(wallet);
  const bytes = a.dbWalletImportV2.encodeImportV2Bytes(wallet, "Nord Glow");

  const b = makeEnv({ deviceKey: "devB" });
  const remote = b.dbWalletImportV2.decodeImportV2Bytes(bytes);
  assert.equal(remote.walletId, wallet.walletId);
  assert.equal(remote.theme, "Nord Glow");
  const built = b.dbWalletImportV2.buildImportedWallet(remote);
  assert.equal(built.userId, "anna");
  assert.deepEqual(
    plain(built.wallet.events.map((e) => e.id).sort()),
    plain(wallet.events.map((e) => e.id).sort()),
  );
  const sa = summary(a, wallet);
  const sb = summary(b, built.wallet);
  assert.equal(sb.total, sa.total);
  assert.equal(sb.unpaid, sa.unpaid);
  assert.equal(sb.credit, sa.credit);
});

test("two-tab id collision: saveWallet re-mints and keeps both bookings", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const tabA = S.loadWallet("anna");
  S.saveWallet(tabA);
  const tabB = S.loadWallet("anna");
  // Both tabs mint devA.1 for different bookings.
  S.appendEvents(tabA, [S.newEvent(tabA, "d", 1)]);
  const evB = S.newEvent(tabB, "d", 2);
  evB.ts += 1;
  S.appendEvents(tabB, [evB]);
  const reloaded = S.loadWallet("anna");
  assert.equal(reloaded.events.length, 2);
  assert.ok(reloaded.events.some((e) => e.id === "devA.1" && e.n === 1));
  assert.ok(reloaded.events.some((e) => e.id !== "devA.1" && e.n === 2));
  assert.equal(summary(w, reloaded).total, 3);
});

test("two tabs: action code created in tab A survives a stale save in tab B", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const tabB = S.loadWallet("anna");
  S.saveWallet(tabB);
  const tabA = S.loadWallet("anna");
  tabA.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "A" }));
  S.saveWallet(tabA);
  S.appendEvents(tabB, [S.newEvent(tabB, "d", 1)]);
  const reloaded = S.loadWallet("anna");
  assert.equal(reloaded.actionCodes.length, 1);
  assert.equal(reloaded.actionCodes[0].label, "A");
});

test("loading and saving a normal wallet is stable (control case)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  let wallet = S.loadWallet("bob");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 4)]);
  S.appendEvents(wallet, [S.newEvent(wallet, "p")]);
  for (let i = 0; i < 3; i++) {
    wallet = S.loadWallet("bob");
    S.ensureDeviceSeq(wallet);
    S.saveWallet(wallet);
  }
  assert.equal(S.loadWallet("bob").events.length, 3);
});
