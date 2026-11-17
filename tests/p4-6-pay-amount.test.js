// P4.6: "heute bezahlen" settles every open drink, not today's — the button
// says "Alle N offenen bezahlen" and is disabled at 0. Enter in the amount
// field books. E5: at most 99 drinks per booking (field max), a confirm from
// 20, credit at most 999; edits keep the same limits. P4.9 for this block:
// opening "Bezahlen" puts the focus on the first usable option.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage } = require("./wallet-page");
const { makeEnv, plain, REPO } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

function seedOpen(n) {
  return (e) => {
    const S = e.dbWalletStorage;
    const x = S.loadWallet("max");
    if (n > 0) S.appendEvents(x, [S.newEvent(x, "d", n)]);
    else S.saveWallet(x);
  };
}

const $ = (w, id) => w.document.getElementById(id);
const unpaid = (w) => $(w, "unpaid").textContent;
const statusText = (w) => $(w, "status-text").textContent;
// The confirm dialog answers with a Promise (window.confirm as the fallback).
const settle = () => new Promise((r) => setTimeout(r, 0));

test("wallet.html: amount field has max 99; the pay button has no fixed label", () => {
  const html = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
  assert.match(html, /<input id="amount" type="number" min="1" max="99"/);
  assert.doesNotMatch(html, /heute bezahlen/i);
  const w = makeEnv();
  assert.equal(w.dbWalletActions.LIMITS.drinkMax, 99);
  assert.equal(w.dbWalletActions.LIMITS.creditMax, 999);
  assert.equal(w.dbWalletActions.LIMITS.drinkConfirmFrom, 20);
});

test("pay button names the open drinks and is disabled at 0", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(3) });
  assert.equal($(w, "btn-pay-today").textContent, "Alle 3 offenen bezahlen 💰");
  assert.equal($(w, "btn-pay-today").disabled, false);
  $(w, "btn-pay").click();
  $(w, "btn-pay-today").click();
  assert.equal(unpaid(w), "0");
  assert.equal(statusText(w), "3 Getränke bezahlt · Offen: 0");
  assert.equal($(w, "btn-pay-today").textContent, "Alle 0 offenen bezahlen 💰");
  assert.equal($(w, "btn-pay-today").disabled, true);
  $(w, "btn-drink").click();
  assert.equal($(w, "btn-pay-today").textContent, "Alle 1 offenen bezahlen 💰");
  assert.equal($(w, "btn-pay-today").disabled, false);
});

test("Bezahlen moves the focus to the first usable option", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(0) });
  const focused = [];
  for (const id of ["btn-pay-today", "btn-credit", "btn-pay"]) {
    $(w, id).focus = () => focused.push(id);
  }
  $(w, "btn-pay").click();
  assert.deepEqual(focused, ["btn-credit"], "nothing open: pay is disabled");
  $(w, "btn-pay-cancel").click();
  assert.deepEqual(focused, ["btn-credit", "btn-pay"], "cancel returns to Bezahlen");
  $(w, "btn-drink").click();
  $(w, "btn-pay").click();
  assert.deepEqual(focused.slice(2), ["btn-pay-today"]);
});

function keydown(el, key) {
  let prevented = false;
  for (const fn of el.listeners.keydown || []) {
    fn({ key, target: el, preventDefault: () => (prevented = true) });
  }
  return prevented;
}

test("Enter in the amount field books; not while the pay options are open", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  $(w, "amount").value = "2";
  assert.equal(keydown($(w, "amount"), "Enter"), true);
  assert.equal(unpaid(w), "3");
  assert.equal($(w, "amount").value, "1", "field reset after booking");
  keydown($(w, "amount"), "a");
  assert.equal(unpaid(w), "3");
  $(w, "btn-pay").click();
  keydown($(w, "amount"), "Enter");
  assert.equal(unpaid(w), "3");
});

test("more than 99 drinks are refused, from 20 on it asks first", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(0) });
  const asked = [];
  let answer = false;
  w.confirm = (m) => {
    asked.push(String(m));
    return answer;
  };
  $(w, "amount").value = "100";
  $(w, "btn-drink").click();
  assert.equal(unpaid(w), "0");
  assert.equal(statusText(w), "Höchstens 99 Getränke auf einmal.");
  assert.equal(asked.length, 0);

  $(w, "amount").value = "19";
  $(w, "btn-drink").click();
  assert.equal(unpaid(w), "19");
  assert.equal(asked.length, 0);

  $(w, "amount").value = "20";
  $(w, "btn-drink").click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /20 Getränke/);
  assert.equal(unpaid(w), "19", "declined");
  assert.equal($(w, "amount").value, "20", "a declined booking keeps the field");

  answer = true;
  $(w, "btn-drink").click();
  assert.equal(unpaid(w), "19", "nothing booked before the answer");
  await settle();
  assert.equal(unpaid(w), "39");
  assert.deepEqual(plain(w._alerts), []);
});

test("credit is at most 999", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const wallet = w.dbWalletStorage.loadWallet("max");
  const { ctx, state } = makeActionsCtx(w, wallet);
  assert.equal(w.dbWalletActions.bookCredit(ctx, "1000"), false);
  assert.equal(state.wallet.events.length, 0);
  assert.match(state.alerts[0], /Höchstens 999/);
  // Only whole numbers: "2.5", "-3", "1e3" and "" are typos.
  for (const typo of ["2.5", "-3", "1e3", ""]) {
    assert.equal(w.dbWalletActions.bookCredit(ctx, typo), false, typo);
  }
  assert.equal(state.alerts.filter((a) => /Ungültige Menge/.test(a)).length, 4);
  assert.equal(w.dbWalletActions.bookCredit(ctx, " 999 "), true);
  assert.equal(state.wallet.events.length, 1);
  assert.equal(state.wallet.events[0].n, 999);
});

test("editing keeps the limits: drinks 99, credit 999", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("max");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1), S.newEvent(wallet, "g", 5)]);
  const today = w.dbWalletSummary.todayDateStr();
  const [drink, credit] = wallet.events;
  const edit = (pos, amount) => {
    const { ctx, state } = makeActionsCtx(w, wallet);
    w.dbWalletActions.editEntry(ctx, (pos === 1 ? drink : credit).id, { date: today, amount });
    return state;
  };
  let st = edit(1, "100");
  assert.match(st.alerts.join(" "), /Höchstens 99/);
  assert.equal(wallet.events.length, 2);
  st = edit(2, "1000");
  assert.match(st.alerts.join(" "), /Höchstens 999/);
  assert.equal(wallet.events.length, 2);
  st = edit(1, "99");
  assert.deepEqual(plain(st.alerts), []);
  assert.equal(wallet.events.length, 3);
});
