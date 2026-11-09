// P1.2: deletion model for action codes (plan Anhang A1).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");
const { makeFakeDocument, button, card } = require("./fake-dom");


test("A1: deleting a local action code sticks after reload", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const wallet = S.loadWallet("anna");
  wallet.actionCodes.push(AC.buildActionCode({ type: "g", amount: 5, label: "A" }));
  wallet.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "B" }));
  S.saveWallet(wallet);
  const del = wallet.actionCodes[0].id;
  AC.removeActionCode(wallet, del);
  S.saveWallet(wallet);
  const loaded = S.loadWallet("anna");
  assert.equal(loaded.actionCodes.length, 1);
  assert.ok(!loaded.actionCodes.some((c) => c.id === del));
});

test("A1: deleting a global action code sticks after reload", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const wallet = S.loadWallet("anna");
  wallet.globalActionCodes = [
    { id: "global:g1", label: "G1", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
    { id: "global:g2", label: "G2", amount: 3, type: "g", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.saveWallet(wallet);
  AC.removeActionCode(wallet, "global:g1");
  S.saveWallet(wallet);
  const loaded = S.loadWallet("anna");
  assert.equal(JSON.stringify(loaded.globalActionCodes.map((c) => c.id)), '["global:g2"]');
});

test("delete, then import an export that still has the code: stays deleted", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const I = w.dbWalletImportV2;
  const wallet = S.loadWallet("anna");
  wallet.actionCodes.push(AC.buildActionCode({ type: "g", amount: 5, label: "A" }));
  wallet.globalActionCodes = [
    { id: "global:g1", label: "G1", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  const oldExport = I.encodeImportV2Bytes(S.loadWallet("anna"), null);
  const localId = wallet.actionCodes[0].id;

  const now = S.loadWallet("anna");
  AC.removeActionCode(now, localId);
  AC.removeActionCode(now, "global:g1");
  S.saveWallet(now);

  const built = I.buildImportedWallet(I.decodeImportV2Bytes(oldExport));
  assert.equal(built.userId, "anna");
  S.saveWallet(built.wallet);
  const loaded = S.loadWallet("anna");
  assert.equal(loaded.actionCodes.length, 0);
  assert.equal((loaded.globalActionCodes || []).length, 0);
});

test("deletion list is capped at the 50 newest entries", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const wallet = S.loadWallet("anna");
  for (let i = 0; i < 60; i++) AC.removeActionCode(wallet, "c" + i, 1000 + i);
  S.saveWallet(wallet);
  const del = S.loadWallet("anna").deletedActionCodes;
  const keys = Object.keys(del);
  assert.equal(keys.length, 50);
  assert.ok(!keys.includes("c0"));
  assert.ok(keys.includes("c59"));
});

// UI flows through the real panel (action-codes.js initActionCodesUi).
function mountPanel(w, userId) {
  const S = w.dbWalletStorage;
  let wallet = S.loadWallet(userId);
  const container = w.document.createElement("div");
  const ui = w.dbWalletActionCodes.initActionCodesUi({
    container,
    getWallet: () => wallet,
    persistWallet: (next) => {
      wallet = next;
      S.saveWallet(wallet);
    },
    getBaseUrl: () => "https://example.invalid/wallet.html",
  });
  return {
    container,
    ui,
    get wallet() {
      return wallet;
    },
    set wallet(v) {
      wallet = v;
    },
  };
}

test("UI: converting local -> global leaves exactly one code", () => {
  const w = makeEnv({ deviceKey: "devA", document: makeFakeDocument() });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const seed = S.loadWallet("anna");
  seed.actionCodes.push(AC.buildActionCode({ type: "d", amount: 2, label: "Lok" }));
  S.saveWallet(seed);

  const p = mountPanel(w, "anna");
  button(card(p.container, "Lok"), "Bearbeiten").click();
  const c = card(p.container, "Lok");
  button(c, "🌍 Global").click();
  button(c, "Speichern").click();

  const loaded = S.loadWallet("anna");
  const total = loaded.actionCodes.length + (loaded.globalActionCodes || []).length;
  assert.equal(total, 1);
  assert.equal(loaded.actionCodes.length, 0);
  assert.equal(loaded.globalActionCodes[0].scope, "global");
});

test("UI: converting global -> local leaves exactly one code", () => {
  const w = makeEnv({ deviceKey: "devA", document: makeFakeDocument() });
  const S = w.dbWalletStorage;
  const seed = S.loadWallet("anna");
  seed.globalActionCodes = [
    { id: "global:g1", label: "Glob", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.saveWallet(seed);

  const p = mountPanel(w, "anna");
  button(card(p.container, "Glob"), "Bearbeiten").click();
  const c = card(p.container, "Glob");
  button(c, "🔒 Lokal").click();
  button(c, "Speichern").click();

  const loaded = S.loadWallet("anna");
  assert.equal((loaded.globalActionCodes || []).length, 0);
  assert.equal(loaded.actionCodes.length, 1);
});

test("UI: deleting a local and a global code sticks after reload", () => {
  const w = makeEnv({ deviceKey: "devA", document: makeFakeDocument() });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const seed = S.loadWallet("anna");
  seed.actionCodes.push(AC.buildActionCode({ type: "d", amount: 2, label: "Lok" }));
  seed.globalActionCodes = [
    { id: "global:g1", label: "Glob", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.saveWallet(seed);

  const p = mountPanel(w, "anna");
  button(card(p.container, "Lok"), "Löschen").click();
  // the confirm box replaces the QR; its "Löschen" is the second one in the card
  const lok = card(p.container, "Lok");
  const confirmBox = lok.children.find((ch) => ch.className === "action-code-confirm");
  button(confirmBox, "Löschen").click();
  button(card(p.container, "Glob"), "Löschen").click();
  const glob = card(p.container, "Glob");
  button(glob.children.find((ch) => ch.className === "action-code-confirm"), "Löschen").click();

  const loaded = S.loadWallet("anna");
  assert.equal(loaded.actionCodes.length, 0);
  assert.equal((loaded.globalActionCodes || []).length, 0);
});
