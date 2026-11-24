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
