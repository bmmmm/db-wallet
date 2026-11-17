// P5.1: action-codes.js is the logic (no DOM); the panel lives in
// action-codes-ui.js. Create / edit / convert / delete are pure functions
// (wallet, change) -> { wallet: next }: the input stays untouched and the
// panel saves the result once (a local <-> global conversion used to save
// twice, the first time with the old code already gone).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, plain, REPO } = require("./harness");
const { makeFakeDocument, button, card } = require("./fake-dom");

function env() {
  const w = makeEnv({ deviceKey: "devA" });
  const AC = w.dbWalletActionCodes;
  const wallet = w.dbWalletStorage.loadWallet("anna");
  wallet.actionCodes = [AC.buildActionCode({ type: "g", amount: 5, label: "Fünf" }, 1000)];
  wallet.globalActionCodes = [
    { id: "global:g1", label: "Runde", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  return { w, AC, wallet };
}

const snap = (x) => JSON.stringify(x);

test("action-codes.js has no DOM code; the panel is in action-codes-ui.js", () => {
  const logic = fs.readFileSync(path.join(REPO, "action-codes.js"), "utf8");
  assert.doesNotMatch(logic, /document\.|createElement|innerHTML|canvas/);
  const w = makeEnv();
  assert.equal(typeof w.dbWalletActionCodesUI.initActionCodesUi, "function");
  assert.equal(w.dbWalletActionCodes.initActionCodesUi, undefined);
  // index.html needs only the logic.
  const index = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  assert.doesNotMatch(index, /action-codes-ui\.js/);
  assert.match(fs.readFileSync(path.join(REPO, "wallet.html"), "utf8"), /action-codes\.js" defer><\/script>\s*<script src="action-codes-ui\.js"/);
});

test("createActionCode: local and global, input untouched", () => {
  const { AC, wallet } = env();
  const before = snap(wallet);
  const local = AC.createActionCode(wallet, { scope: "local", type: "d", amount: "3", label: "Drei" }, 2000);
  assert.equal(snap(wallet), before);
  assert.equal(local.wallet.actionCodes.length, 2);
  const made = local.wallet.actionCodes.find((c) => c.id === local.code.id);
  assert.ok(made.key, "a local code has a key");
  assert.equal(made.amount, 3);

  const global = AC.createActionCode(wallet, { scope: "global", type: "g", amount: "150", label: "" }, 2000);
  assert.equal(snap(wallet), before);
  const g = global.wallet.globalActionCodes.find((c) => c.id === global.code.id);
  assert.match(g.id, /^global:/);
  assert.equal(g.key, undefined);
  assert.equal(g.amount, 100, "global amount capped at 100");
  assert.equal(g.label, "Guthaben +100");
});

test("createActionCode on a wallet without global codes doesn't add the field", () => {
  const w = makeEnv();
  const wallet = w.dbWalletStorage.loadWallet("max");
  const r = w.dbWalletActionCodes.createActionCode(wallet, { scope: "local", type: "d", amount: 1 });
  assert.equal("globalActionCodes" in r.wallet, false);
});

test("editActionCode: same scope edits in place (local rotates the key)", () => {
  const { AC, wallet } = env();
  const before = snap(wallet);
  const id = wallet.actionCodes[0].id;
  const oldKey = wallet.actionCodes[0].key;
  const r = AC.editActionCode(wallet, id, { scope: "local", type: "g", amount: 7, label: "Sieben" }, 3000);
  assert.equal(snap(wallet), before);
  const c = r.wallet.actionCodes.find((x) => x.id === id);
  assert.equal(c.amount, 7);
  assert.equal(c.label, "Sieben");
  assert.notEqual(c.key, oldKey, "key rotated: old QR codes stop booking");

  const g = AC.editActionCode(wallet, "global:g1", { type: "g", amount: 500, label: " " }, 3000);
  const gc = g.wallet.globalActionCodes.find((x) => x.id === "global:g1");
  assert.equal(gc.amount, 100);
  assert.equal(gc.type, "g");
  assert.equal(gc.label, "Guthaben +100");
  assert.equal(gc.updatedAt, 3000);
});

test("editActionCode: local -> global and global -> local convert (old id recorded)", () => {
  const { AC, wallet } = env();
  const before = snap(wallet);
  const id = wallet.actionCodes[0].id;
  const toGlobal = AC.editActionCode(wallet, id, { scope: "global", type: "d", amount: 4, label: "Vier" }, 4000);
  assert.equal(snap(wallet), before);
  assert.equal(toGlobal.wallet.actionCodes.length, 0);
  assert.ok(id in toGlobal.wallet.deletedActionCodes);
  assert.match(toGlobal.code.id, /^global:/);
  assert.deepEqual(
    Array.from(toGlobal.wallet.globalActionCodes, (c) => c.label).sort(),
    ["Runde", "Vier"],
  );

  const toLocal = AC.editActionCode(wallet, "global:g1", { scope: "local", type: "d", amount: 2, label: "Runde" }, 4000);
  assert.equal(toLocal.wallet.globalActionCodes.length, 0);
  assert.ok("global:g1" in toLocal.wallet.deletedActionCodes);
  assert.ok(toLocal.code.key);
  assert.equal(toLocal.wallet.actionCodes.length, 2);
  assert.equal(AC.editActionCode(wallet, "nope", { scope: "local" }), null);
});

test("deleteActionCode records the id; the input stays", () => {
  const { AC, wallet } = env();
  const before = snap(wallet);
  const r = AC.deleteActionCode(wallet, "global:g1", 5000);
  assert.equal(snap(wallet), before);
  assert.equal(r.removed, true);
  assert.equal(r.wallet.globalActionCodes.length, 0);
  assert.equal(plain(r.wallet.deletedActionCodes)["global:g1"], 5000);
  assert.equal(AC.deleteActionCode(wallet, "nope").removed, false);
});

test("buildActionUrl: acg: for global, ac: with the key for local", () => {
  const { AC, wallet } = env();
  const g = AC.buildActionUrl(wallet, wallet.globalActionCodes[0], "https://x.invalid/wallet.html");
  assert.match(g, /^https:\/\/x\.invalid\/wallet\.html#acg:/);
  const p = AC.decodeGlobalActionHash(g.split("#")[1]);
  assert.deepEqual(plain(p), { v: 1, t: "d", n: 2, l: "Runde" });
  const l = AC.buildActionUrl(wallet, wallet.actionCodes[0], "https://x.invalid/wallet.html");
  const d = AC.decodeActionHash(l.split("#")[1]);
  assert.equal(d.codeId, wallet.actionCodes[0].id);
  assert.equal(d.key, wallet.actionCodes[0].key);
});

function mountPanel() {
  const w = makeEnv({ deviceKey: "devA", document: makeFakeDocument() });
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const seed = S.loadWallet("anna");
  seed.actionCodes = [AC.buildActionCode({ type: "g", amount: 5, label: "Fünf" })];
  S.saveWallet(seed);
  let wallet = S.loadWallet("anna");
  const saves = [];
  const container = w.document.createElement("div");
  w.dbWalletActionCodesUI.initActionCodesUi({
    container,
    getWallet: () => wallet,
    persistWallet: (next) => {
      saves.push(JSON.parse(JSON.stringify(next)));
      if (S.saveWallet(next)) wallet = next;
    },
    getBaseUrl: () => "https://example.invalid/wallet.html",
  });
  return { w, S, container, saves, get wallet() { return wallet; } };
}

test("panel: converting local -> global is one save, never a state without the code", () => {
  const t = mountPanel();
  const c = card(t.container, "Fünf");
  button(c, "Bearbeiten").click();
  button(card(t.container, "Fünf"), "🌍 Global").click();
  t.saves.length = 0;
  button(t.container, "Speichern").click();
  assert.equal(t.saves.length, 1, "saves: " + t.saves.length);
  assert.equal(t.saves[0].actionCodes.length, 0);
  assert.equal(t.saves[0].globalActionCodes.length, 1);
  const stored = t.S.loadWallet("anna");
  assert.equal(stored.actionCodes.length, 0);
  assert.equal(stored.globalActionCodes[0].label, "Fünf");
  assert.ok(card(t.container, "Fünf"), "the converted code is shown");
});

test("panel: a refused save leaves the shown codes as stored", () => {
  const t = mountPanel();
  t.w.localStorage.quota = 10;
  button(card(t.container, "Fünf"), "Löschen").click();
  button(t.container, "Löschen").click();
  t.w.localStorage.quota = Infinity;
  assert.equal(t.S.loadWallet("anna").actionCodes.length, 1);
  assert.ok(card(t.container, "Fünf"), "still shown, like in storage");
});
