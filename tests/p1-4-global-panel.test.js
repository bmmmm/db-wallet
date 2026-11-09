// P1.4: the action-code panel always reads global codes from the current wallet.
// Driven through the real panel (initActionCodesUi) on a fake DOM.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");
const { makeFakeDocument, button, card } = require("./fake-dom");

const TODO = { todo: "P1.4" };

function setup() {
  const w = makeEnv({ deviceKey: "devA", document: makeFakeDocument() });
  const S = w.dbWalletStorage;
  const a = S.loadWallet("anna");
  a.globalActionCodes = [
    { id: "global:a1", label: "FromA", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.saveWallet(a);
  S.saveWallet(S.loadWallet("berta"));

  let current = S.loadWallet("anna");
  const container = w.document.createElement("div");
  const ui = w.dbWalletActionCodes.initActionCodesUi({
    container,
    getWallet: () => current,
    persistWallet: (next) => {
      current = next;
      S.saveWallet(current);
    },
    getBaseUrl: () => "https://example.invalid/wallet.html",
  });
  return {
    w, S, container, ui,
    switchTo(userId) {
      current = S.loadWallet(userId);
      ui.refresh();
    },
  };
}

test("after a wallet switch the panel shows the new wallet's global codes", TODO, () => {
  const t = setup();
  assert.ok(card(t.container, "FromA"), "A's code shown while A is open");
  t.switchTo("berta");
  assert.equal(card(t.container, "FromA"), null);
});

test("wallet A with global code, switch to B, create code in B: B has only the new code", TODO, () => {
  const t = setup();
  t.switchTo("berta");
  button(t.container, "New action code").click();
  button(t.container, "🌍 Global").click();
  button(t.container, "Speichern").click();

  const b = t.S.loadWallet("berta");
  assert.equal(b.globalActionCodes.length, 1);
  assert.notEqual(b.globalActionCodes[0].id, "global:a1");
  const a = t.S.loadWallet("anna");
  assert.equal(JSON.stringify(a.globalActionCodes.map((c) => c.id)), '["global:a1"]');
});
