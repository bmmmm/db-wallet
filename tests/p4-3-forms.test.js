// P4.3: credit is an inline form (type="number", max 999) instead of
// prompt(); confirmations go through one shared <dialog> (#confirm-dialog,
// dbWalletHelpers.confirmDialog → Promise<boolean>), with window.confirm as
// the fallback where the page has no dialog. The edit form lives in the
// history rows (p4-4). P4.9 for these blocks: the form and the dialog move
// the focus in and give it back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage, seedOpen, statusText } = require("./wallet-page");
const { makeEnv, plain, settle, REPO } = require("./harness");
const { makeFakeDocument } = require("./fake-dom");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const $ = (w, id) => w.document.getElementById(id);
const isError = (w) => $(w, "status-line").classList.contains("is-error");
// Gives the page's #confirm-dialog the two methods of HTMLDialogElement the
// helper uses, and records what it showed.
function fakeDialog(w) {
  const dlg = $(w, "confirm-dialog");
  const shown = [];
  dlg.showModal = () => {
    dlg.open = true;
    shown.push($(w, "confirm-text").textContent);
  };
  dlg.close = () => {
    dlg.open = false;
    dlg.dispatch("close");
  };
  return { dlg, shown };
}

test("wallet.html: credit form and confirm dialog; no prompt() in the booking flows", () => {
  const html = read("wallet.html");
  assert.match(html, /<dialog id="confirm-dialog" class="confirm-dialog"/);
  assert.match(html, /<p id="confirm-text"/);
  assert.match(html, /<button id="confirm-ok" type="button"/);
  assert.match(html, /<button id="confirm-cancel" type="button"/);
  assert.match(html, /<form id="credit-form" class="credit-form" novalidate>/);
  assert.match(
    html,
    /<input id="credit-amount" type="number" min="1" max="999" value="10" inputmode="numeric"/,
  );
  const actions = read("wallet-actions.js");
  assert.doesNotMatch(actions, /prompt\(|dialogPrompt/);
  // M1: the v1 → v2 migration choice is gone too (silent on load).
  assert.doesNotMatch(read("wallet-ui.js"), /prompt\(/);
  // Hidden until opened (CSP: no inline style in the markup).
  assert.match(read("style.css"), /#credit-form\s*\{\s*display:\s*none;/);
});

test("confirmDialog: OK, Abbrechen and Escape; focus goes back", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  const { dlg, shown } = fakeDialog(w);
  const H = w.dbWalletHelpers;
  const opener = $(w, "btn-reset");
  w.document.activeElement = opener;
  let refocused = 0;
  opener.focus = () => refocused++;

  let p = H.confirmDialog("Wirklich?", { okLabel: "Löschen", danger: true });
  assert.equal(dlg.open, true);
  assert.deepEqual(shown, ["Wirklich?"]);
  assert.equal($(w, "confirm-ok").textContent, "Löschen");
  assert.equal($(w, "confirm-cancel").textContent, "Abbrechen");
  assert.ok(dlg.classList.contains("is-danger"));
  $(w, "confirm-ok").click();
  assert.equal(await p, true);
  assert.equal(dlg.open, false);
  assert.equal(refocused, 1, "focus returns to the opener");

  p = H.confirmDialog("Noch mal?");
  assert.equal($(w, "confirm-ok").textContent, "OK");
  assert.ok(!dlg.classList.contains("is-danger"));
  $(w, "confirm-cancel").click();
  assert.equal(await p, false);

  // Escape: the browser fires "cancel" and closes the dialog.
  p = H.confirmDialog("Escape?");
  dlg.dispatch("cancel");
  dlg.close();
  assert.equal(await p, false);
  // Old listeners are gone: a later OK answers only its own question.
  p = H.confirmDialog("Letzte?");
  $(w, "confirm-ok").click();
  assert.equal(await p, true);
  assert.deepEqual(plain(w._alerts), []);
});

test("confirmDialog falls back to window.confirm without a dialog", async () => {
  const w = makeEnv({ document: makeFakeDocument() });
  const asked = [];
  w.confirm = (m) => {
    asked.push(String(m));
    return false;
  };
  const p = w.dbWalletHelpers.confirmDialog("Sicher?");
  assert.equal(typeof p.then, "function");
  assert.equal(await p, false);
  assert.deepEqual(asked, ["Sicher?"]);
});

test("20 drinks: the page asks through the dialog, OK books", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(0) });
  const { shown } = fakeDialog(w);
  w.confirm = () => {
    throw new Error("native confirm used");
  };
  $(w, "amount").value = "20";
  $(w, "btn-drink").click();
  assert.deepEqual(shown, ["Wirklich 20 Getränke auf einmal buchen?"]);
  assert.equal($(w, "unpaid").textContent, "0", "nothing booked before the answer");
  $(w, "confirm-ok").click();
  await settle();
  assert.equal($(w, "unpaid").textContent, "20");
  assert.equal(statusText(w), "+20 gebucht · Offen: 20");
});

test("Guthaben aufladen opens the form; submit books, the form closes", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(3) });
  const focused = [];
  for (const id of ["credit-amount", "btn-pay", "btn-credit"]) $(w, id).focus = () => focused.push(id);
  w.prompt = () => {
    throw new Error("prompt used");
  };
  $(w, "btn-pay").click();
  $(w, "btn-credit").click();
  assert.equal($(w, "credit-form").style.display, "flex");
  assert.equal($(w, "btn-credit").getAttribute("aria-expanded"), "true");
  assert.equal(focused[focused.length - 1], "credit-amount");
  $(w, "credit-amount").value = "10";
  $(w, "credit-form").dispatch("submit");
  assert.equal(statusText(w), "Guthaben +10 gebucht · Guthaben: 7");
  assert.equal($(w, "credit-form").style.display, "none");
  assert.equal($(w, "pay-options").style.display, "none");
  assert.equal($(w, "btn-credit").getAttribute("aria-expanded"), "false");
  assert.equal(focused[focused.length - 1], "btn-pay");
  assert.equal($(w, "credit-amount").value, "10", "reset to the default");
});

test("credit form: typo and > 999 are errors, the form stays open", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  $(w, "btn-pay").click();
  $(w, "btn-credit").click();
  // A number input turns a typo into "".
  $(w, "credit-amount").value = "";
  $(w, "credit-form").dispatch("submit");
  assert.equal(statusText(w), "Ungültige Menge für die Gutschrift.");
  assert.ok(isError(w));
  assert.equal($(w, "credit-form").style.display, "flex");
  $(w, "credit-amount").value = "1000";
  $(w, "credit-form").dispatch("submit");
  assert.equal(statusText(w), "Höchstens 999 Getränke Guthaben auf einmal.");
  assert.equal($(w, "credit-form").style.display, "flex");
  assert.equal($(w, "unpaid").textContent, "1");
});

test("credit form: Abbrechen closes it, focus back on Guthaben aufladen", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  const focused = [];
  $(w, "btn-credit").focus = () => focused.push("btn-credit");
  $(w, "btn-pay").click();
  $(w, "btn-credit").click();
  $(w, "btn-credit-cancel").click();
  assert.equal($(w, "credit-form").style.display, "none");
  assert.equal($(w, "pay-options").style.display, "flex", "pay options stay");
  assert.deepEqual(focused, ["btn-credit"]);
  // "Bezahlen abbrechen" closes everything, the form included.
  $(w, "btn-credit").click();
  $(w, "btn-pay-cancel").click();
  assert.equal($(w, "credit-form").style.display, "none");
  assert.equal($(w, "pay-options").style.display, "none");
});

test("reset asks through the dialog; Abbrechen keeps the data", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(2) });
  const { shown } = fakeDialog(w);
  $(w, "btn-reset").click();
  assert.equal(shown.length, 1);
  assert.match(shown[0], /alle Getränkedaten für „max“/);
  assert.ok($(w, "confirm-dialog").classList.contains("is-danger"));
  $(w, "confirm-cancel").click();
  await settle();
  assert.equal($(w, "unpaid").textContent, "2");
  $(w, "btn-reset").click();
  $(w, "confirm-ok").click();
  await settle();
  assert.equal($(w, "unpaid").textContent, "0");
  assert.equal(statusText(w), "Alle Daten für „max“ gelöscht.");
});

test("confirmDialog: a second question declines the first; a stale close event is ignored", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  const { dlg } = fakeDialog(w);
  const H = w.dbWalletHelpers;
  const first = H.confirmDialog("Erste?");
  const second = H.confirmDialog("Zweite?");
  assert.equal(await first, false);
  assert.equal($(w, "confirm-text").textContent, "Zweite?");
  // dialog.close() delivers its "close" event later, as a task: by then the
  // dialog may be open again for the next question.
  dlg.open = true;
  dlg.dispatch("close");
  let answered = false;
  second.then(() => (answered = true));
  await settle();
  assert.equal(answered, false, "the stale close event does not answer");
  $(w, "confirm-ok").click();
  assert.equal(await second, true);
});

test("undo of a pay: another tab books before the answer, nothing is undone", async () => {
  const { makeStorage } = require("./harness");
  const storage = makeStorage();
  const w = await bootWalletPage({
    hash: "max",
    storage,
    seed: (e) => {
      const S = e.dbWalletStorage;
      const x = S.loadWallet("max");
      S.appendEvents(x, [S.newEvent(x, "d", 2), S.newEvent(x, "p")]);
    },
  });
  const { shown } = fakeDialog(w);
  $(w, "btn-undo").click();
  assert.match(shown[0], /letzte Bezahlung/);
  const tab2 = makeEnv({ storage, deviceKey: "devB" });
  const S2 = tab2.dbWalletStorage;
  const other = S2.loadWallet("max");
  S2.appendEvents(other, [S2.newEvent(other, "d", 3)]);
  w._dispatch("storage", { key: "db-wallet:max" });
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(statusText(w), "Der Verlauf hat sich inzwischen geändert — nichts rückgängig gemacht.");
  const evs = w.dbWalletStorage.loadWallet("max").events;
  assert.equal(evs.filter((e) => e.t === "x").length, 0);
  assert.equal($(w, "unpaid").textContent, "3");
});

test("deleting a row that another tab deleted meanwhile writes nothing", async () => {
  const { makeStorage } = require("./harness");
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(2) });
  const { shown } = fakeDialog(w);
  const { findAll, find } = require("./fake-dom");
  $(w, "mode-log").click();
  $(w, "log-edit-toggle").checked = true;
  $(w, "log-edit-toggle").dispatch("change");
  const del = find($(w, "history-list"), (el) => el.tagName === "BUTTON" && el.textContent === "Löschen");
  del.click();
  assert.equal(shown.length, 1);
  const tab2 = makeEnv({ storage, deviceKey: "devB" });
  const S2 = tab2.dbWalletStorage;
  const other = S2.loadWallet("max");
  const root = other.events[0].id;
  S2.appendEvents(other, [S2.newEvent(other, "x")].map((t) => Object.assign(t, { ref: root })));
  w._dispatch("storage", { key: "db-wallet:max" });
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(statusText(w), "Dieser Eintrag ist schon entfernt.");
  const tombs = w.dbWalletStorage.loadWallet("max").events.filter((e) => e.t === "x");
  assert.equal(tombs.length, 1, "only tab 2's tombstone");
  assert.equal(findAll($(w, "history-list"), (el) => el.classList.contains("history-row")).length, 0);
});
