// The action-code panel follows the stored wallet: when another tab changes
// the codes (a key rotation, a delete), the storage event re-renders it, so
// no card keeps a revoked link. A change that leaves the codes alone (a
// booking) keeps the panel as it is, with what was typed in an open form.
// An edit of a code that is gone meanwhile says so instead of doing nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, BASE } = require("./wallet-page");
const { makeEnv, makeStorage, plain } = require("./harness");
const { find, findAll, button, card } = require("./fake-dom");

function seedCode(e) {
  const S = e.dbWalletStorage;
  const AC = e.dbWalletActionCodes;
  const x = S.loadWallet("max");
  x.actionCodes = [AC.buildActionCode({ type: "d", amount: 1, label: "Runde" }, 1000)];
  assert.equal(S.saveWallet(x), true);
}

async function twoTabs() {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedCode });
  const tab2 = makeEnv({ storage, deviceKey: "devA" });
  return { w, tab2, body: w.document.getElementById("action-codes-body") };
}

const urlOf = (el) => find(el, (c) => c.classList.contains("action-code-url")).value;
const storageEvent = (w) => w._dispatch("storage", { key: "db-wallet:max" });

function status(w) {
  const line = w.document.getElementById("status-line");
  return {
    text: w.document.getElementById("status-text").textContent,
    error: line.classList.contains("is-error"),
  };
}

// Changes the stored wallet in the second tab, without a storage event.
function changeInTab2(tab2, fn) {
  const S = tab2.dbWalletStorage;
  const res = fn(tab2.dbWalletActionCodes, S.loadWallet("max"));
  assert.equal(S.saveWallet(res.wallet), true);
  return res;
}

test("another tab rotates a code's key: the card shows the new link", async () => {
  const { w, tab2, body } = await twoTabs();
  const before = urlOf(card(body, "Runde"));
  const id = w.dbWalletStorage.loadWallet("max").actionCodes[0].id;
  const res = changeInTab2(tab2, (AC, x) => AC.editActionCode(x, id, { type: "d", amount: 3, label: "Runde" }));
  storageEvent(w);
  const after = urlOf(card(body, "Runde"));
  assert.notEqual(after, before, "the revoked link is gone");
  assert.equal(after, w.dbWalletActionCodes.buildActionUrl(res.wallet, res.code, BASE));
  assert.match(card(body, "Runde").textContent, /\+3 Getränke/);
});

test("another tab deletes the code being edited: the form closes with a notice", async () => {
  const { w, tab2, body } = await twoTabs();
  button(card(body, "Runde"), "Bearbeiten").click();
  assert.ok(find(body, (c) => c.classList.contains("action-code-form")), "edit form open");
  const id = w.dbWalletStorage.loadWallet("max").actionCodes[0].id;
  changeInTab2(tab2, (AC, x) => AC.deleteActionCode(x, id));
  storageEvent(w);
  assert.equal(card(body, "Runde"), null, "the deleted code's card is gone");
  assert.equal(find(body, (c) => c.classList.contains("action-code-form")), null);
  assert.match(status(w).text, /in einem anderen Tab gelöscht/);
});

test("a booking in another tab keeps the open create form and what was typed", async () => {
  const { w, tab2, body } = await twoTabs();
  button(body, "Neuer Action Code").click();
  const form = find(body, (c) => c.classList.contains("action-code-form"));
  const label = findAll(form, (c) => c.tagName === "INPUT" && c.type === "text")[0];
  label.value = "Mein Code";
  const S2 = tab2.dbWalletStorage;
  const x = S2.loadWallet("max");
  assert.equal(S2.appendEvents(x, [S2.newEvent(x, "d", 2)]), true);
  storageEvent(w);
  assert.equal(w.document.getElementById("unpaid").textContent, "2", "the booking shows");
  assert.equal(find(body, (c) => c.classList.contains("action-code-form")), form, "same form");
  assert.equal(label.value, "Mein Code");
});

test("saving an edit of a code deleted meanwhile is an error, nothing re-created", async () => {
  const { w, tab2, body } = await twoTabs();
  button(card(body, "Runde"), "Bearbeiten").click();
  const id = w.dbWalletStorage.loadWallet("max").actionCodes[0].id;
  changeInTab2(tab2, (AC, x) => AC.deleteActionCode(x, id));
  // No storage event yet: this tab still shows the form.
  button(body, "Speichern").click();
  const s = status(w);
  assert.match(s.text, /gelöscht/);
  assert.ok(s.error);
  assert.equal(find(body, (c) => c.classList.contains("action-code-form")), null, "form closed");
  assert.deepEqual(plain(w.dbWalletStorage.loadWallet("max").actionCodes), []);
});

test("a wallet switch closes an open edit form without a notice", async () => {
  const { flushHashChanges } = require("./wallet-page");
  const { w, body } = await twoTabs();
  button(card(body, "Runde"), "Bearbeiten").click();
  w.location.hash = "moritz";
  await flushHashChanges(w);
  assert.equal(w.dbWalletUi.getCurrentUserId(), "moritz");
  assert.equal(card(body, "Runde"), null);
  assert.doesNotMatch(status(w).text, /gelöscht/);
});
