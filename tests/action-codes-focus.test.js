// Every click in the action-code panel re-renders it, so the clicked button
// is gone afterwards. The focus moves on to where the work goes on: into an
// opened form, back to the button that opened it, to the cancel button of a
// delete question (not the destructive one), to "Neuer Action Code" when
// the card is gone.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage } = require("./wallet-page");
const { find, button, card } = require("./fake-dom");

function seedCode(e) {
  const S = e.dbWalletStorage;
  const AC = e.dbWalletActionCodes;
  const x = S.loadWallet("max");
  x.actionCodes = [AC.buildActionCode({ type: "d", amount: 1, label: "Runde" }, 1000)];
  assert.equal(S.saveWallet(x), true);
}

async function boot() {
  const w = await bootWalletPage({ hash: "max", seed: seedCode });
  const focused = [];
  const orig = w.document.createElement;
  w.document.createElement = (tag) => {
    const el = orig(tag);
    el.focus = () => focused.push(el);
    return el;
  };
  const body = w.document.getElementById("action-codes-body");
  return { w, body, last: () => focused[focused.length - 1] };
}

const formOf = (body) => find(body, (c) => c.classList.contains("action-code-form"));
const confirmOf = (body) => find(body, (c) => c.classList.contains("action-code-confirm"));
const amountIn = (form) => find(form, (c) => c.tagName === "INPUT" && c.type === "number");

test("Neuer Action Code: focus into the form; Abbrechen: back to the button", async () => {
  const { body, last } = await boot();
  button(body, "Neuer Action Code").click();
  assert.equal(last(), amountIn(formOf(body)), "the first field of the form");
  button(formOf(body), "Abbrechen").click();
  assert.equal(formOf(body), null);
  assert.equal(last(), button(body, "Neuer Action Code"));
  // Toggling it closed works the same.
  button(body, "Neuer Action Code").click();
  button(body, "Neuer Action Code").click();
  assert.equal(last(), button(body, "Neuer Action Code"));
});

test("a new code: Speichern focuses its card", async () => {
  const { body, last } = await boot();
  button(body, "Neuer Action Code").click();
  const form = formOf(body);
  find(form, (c) => c.tagName === "INPUT" && c.type === "text").value = "Kiste";
  button(form, "Speichern").click();
  assert.equal(last(), button(card(body, "Kiste"), "Bearbeiten"));
});

test("Bearbeiten: focus into the form; Abbrechen and Speichern: back to Bearbeiten", async () => {
  const { body, last } = await boot();
  button(card(body, "Runde"), "Bearbeiten").click();
  assert.equal(last(), amountIn(formOf(body)));
  button(formOf(body), "Abbrechen").click();
  assert.equal(last(), button(card(body, "Runde"), "Bearbeiten"));

  button(card(body, "Runde"), "Bearbeiten").click();
  amountIn(formOf(body)).value = "4";
  button(formOf(body), "Speichern").click();
  assert.match(card(body, "Runde").textContent, /\+4 Getränke/);
  assert.equal(last(), button(card(body, "Runde"), "Bearbeiten"));
});

test("Löschen: focus on the question's Abbrechen; after the delete on Neuer Action Code", async () => {
  const { body, last } = await boot();
  button(card(body, "Runde"), "Löschen").click();
  assert.equal(last(), button(confirmOf(body), "Abbrechen"), "not the destructive button");
  button(confirmOf(body), "Abbrechen").click();
  assert.equal(confirmOf(body), null);
  assert.equal(last(), button(card(body, "Runde"), "Löschen"));

  button(card(body, "Runde"), "Löschen").click();
  button(confirmOf(body), "Löschen").click();
  assert.equal(card(body, "Runde"), null);
  assert.equal(last(), button(body, "Neuer Action Code"));
});
