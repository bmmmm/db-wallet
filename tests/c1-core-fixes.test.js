// Fixes from the data-core cleanup (C1): undo's pay swing over an edit chain,
// reset and a foreign localStorage key, the default label of an edited code,
// the storage banner after a second kind of save failure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

const DAY = 86400000;

function dateOf(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function book(w, userId, type, n, ts) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet(userId);
  const ev = S.newEvent(wallet, type, n);
  ev.ts = ts;
  assert.equal(S.appendEvents(wallet, [ev]), true);
  return ev;
}

test("undo of a moved pay names the drinks it re-opens", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  book(w, "anna", "d", 3, Date.now() - 3 * DAY);
  const { ctx, state } = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.payToday(ctx), true);
  const pay = state.wallet.events.find((e) => e.t === "p");
  assert.equal(
    w.dbWalletActions.editEntry(ctx, pay.id, { date: dateOf(Date.now() - DAY) }),
    true,
  );
  assert.ok(state.wallet.events.some((e) => e.supersedes === pay.id), "the pay is an edit chain now");
  assert.equal(w.dbWalletActions.undoLast(ctx), true);
  assert.match(state.confirms[state.confirms.length - 1], /öffnet 3 Getränk\(e\) wieder/);
  assert.equal(w.dbWalletSummary.computeSummarySafe(S.loadWallet("anna")).unpaid, 3);
});

test("deleting a moved pay names the drinks it re-opens (same count as undo)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  book(w, "anna", "d", 2, Date.now() - 3 * DAY);
  const { ctx, state } = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.payToday(ctx), true);
  const pay = state.wallet.events.find((e) => e.t === "p");
  assert.equal(
    w.dbWalletActions.editEntry(ctx, pay.id, { date: dateOf(Date.now() - DAY) }),
    true,
  );
  assert.equal(w.dbWalletActions.deleteEntry(ctx, pay.id), true);
  assert.match(state.confirms[state.confirms.length - 1], /danach sind 2 Getränke wieder offen/);
});

test("reset leaves a bare localStorage key of the same name alone (another app's)", () => {
  // bmmmm.github.io is one origin for every Pages project: "test" may be
  // another app's key, the wallet lives under "db-wallet:test".
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  w.localStorage.setItem("test", "other app");
  book(w, "test", "d", 1, Date.now() - DAY);
  const { ctx, state } = makeActionsCtx(w, S.loadWallet("test"));
  assert.equal(w.dbWalletActions.resetWallet(ctx), true);
  assert.equal(state.wallet.events.length, 0);
  assert.equal(w.localStorage.getItem("test"), "other app");
});

test("an emptied label on a local edit gets the type's default, like create and global", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const AC = w.dbWalletActionCodes;
  const wallet = w.dbWalletStorage.loadWallet("anna");
  const created = AC.createActionCode(wallet, { scope: "local", type: "d", amount: "5", label: "" });
  assert.equal(created.code.label, "Drink +5");
  const key = created.code.key;
  // The same values with the label field left empty: nothing changed, the
  // key (a printed QR) stays valid.
  const same = AC.editActionCode(created.wallet, created.code.id, { type: "d", amount: "5", label: "" });
  assert.equal(same.code.label, "Drink +5");
  assert.equal(same.code.key, key);
  const credit = AC.editActionCode(same.wallet, created.code.id, { type: "g", amount: "3", label: "  " });
  assert.equal(credit.code.label, "Guthaben +3");
  const global = AC.createActionCode(wallet, { scope: "global", type: "d", amount: "5", label: "" });
  assert.equal(global.code.label, "Drink +5");
});

test("the storage banner follows the latest failure: full storage, then a reset elsewhere", () => {
  const banner = { text: null };
  const messages = {
    showGlobal: (m, o) => {
      if (o && o.id === "storage-error-banner") banner.text = String(m);
    },
    clearGlobal: (o) => {
      if (o && o.id === "storage-error-banner") banner.text = null;
    },
  };
  const w = makeEnv({ deviceKey: "devA", globals: { dbWalletMessages: messages } });
  const S = w.dbWalletStorage;
  book(w, "anna", "d", 1, Date.now() - DAY);
  const wallet = S.loadWallet("anna");
  w.localStorage.quota = 10;
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), false);
  assert.match(banner.text, /Speicher voll/);
  w.localStorage.quota = Infinity;
  // Another tab reset the wallet meanwhile: a new walletId in the store.
  const stored = JSON.parse(w.localStorage.getItem("db-wallet:anna"));
  stored.walletId = "BBBBBBBBBBBBBBBB";
  stored.events = [];
  w.localStorage.setItem("db-wallet:anna", JSON.stringify(stored));
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), false);
  assert.equal(S.getLastSaveError(), "replaced");
  assert.match(banner.text, /in einem anderen Tab zurückgesetzt/);
  // A good save clears it.
  const fresh = S.loadWallet("anna");
  assert.equal(S.appendEvents(fresh, [S.newEvent(fresh, "d", 1)]), true);
  assert.equal(banner.text, null);
});

test("undoLastEvent: tombstone, null, or { status: 'failed' } with the append rolled back", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  assert.equal(S.undoLastEvent(S.loadWallet("anna")), null);
  // A future-dated entry (skewed clock elsewhere): the tombstone carries now,
  // its ts counts nowhere, and the entry is gone all the same.
  const future = book(w, "anna", "d", 2, Date.now() + 3 * DAY);
  const wallet = S.loadWallet("anna");
  w.localStorage.quota = 10;
  const before = plain(wallet.events);
  assert.deepEqual(plain(S.undoLastEvent(wallet)), { status: "failed" });
  assert.deepEqual(plain(wallet.events), before);
  w.localStorage.quota = Infinity;
  const tomb = S.undoLastEvent(wallet);
  assert.equal(tomb.t, "x");
  assert.equal(tomb.ref, future.id);
  assert.ok(tomb.ts <= Date.now());
  const stored = S.loadWallet("anna");
  assert.equal(stored.events.length, 2);
  assert.equal(w.dbWalletSummary.computeSummarySafe(stored).total, 0);
});

test("perDay carries drinks only; the diagram's [count] is the net drinks, also after an 's'", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const Sum = w.dbWalletSummary;
  const ts = new Date("2024-03-01T10:00:00").getTime();
  const s = Sum.computeSummary({
    events: [
      { id: "dev.1", t: "d", n: 3, ts },
      { id: "dev.2", t: "s", n: 2, ts: ts + 60000 },
      { id: "dev.3", t: "p", ts: ts + 120000 },
    ],
  });
  assert.deepEqual(plain(s.perDay), [{ date: "2024-03-01", drinks: 1, paid: true }]);
  assert.deepEqual(plain(Sum.formatPerDayDiagram(s.perDay)), ["2024-03-01 [1] 💰 | #"]);
});

test("wallet.deviceId is no longer minted; a stored one stays harmless", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  assert.equal("deviceId" in S.loadWallet("anna"), false);
  book(w, "anna", "d", 1, Date.now() - DAY);
  assert.equal("deviceId" in JSON.parse(w.localStorage.getItem("db-wallet:anna")), false);
  const old = JSON.parse(w.localStorage.getItem("db-wallet:anna"));
  old.deviceId = "abc123";
  w.localStorage.setItem("db-wallet:anna", JSON.stringify(old));
  const x = S.loadWallet("anna");
  assert.equal(x.deviceId, "abc123");
  assert.equal(S.appendEvents(x, [S.newEvent(x, "d", 1)]), true);
  const { ctx, state } = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.resetWallet(ctx), true);
  assert.equal("deviceId" in state.wallet, false);
});

test("findUserIdByWalletId names the wallet by its key, like getAllWallets", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  book(w, "anna", "d", 1, Date.now() - DAY);
  const stored = JSON.parse(w.localStorage.getItem("db-wallet:anna"));
  // A record whose own userId field disagrees with its key (hand-edited or
  // from an old build): loadWallet opens it as "anna", so the lookup must too.
  stored.userId = "Anna";
  w.localStorage.setItem("db-wallet:anna", JSON.stringify(stored));
  assert.equal(S.findUserIdByWalletId(stored.walletId), "anna");
  assert.deepEqual(Object.keys(S.getAllWallets()), ["anna"]);
  assert.equal(S.loadWallet("anna").walletId, stored.walletId);
  assert.equal(S.findUserIdByWalletId("ZZZZZZZZZZZZZZZZ"), null);
});
