// The logic checks of the old in-browser self-check (self-check.js) that no
// other test covered, ported to Node against today's API. self-check.js keeps
// only what needs a real browser (tests/self-check-smoke.test.js runs it).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, makeStorage, plain, persisted, waitFor } = require("./harness");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");
const { makeActionsCtx } = require("./actions-ctx");
const { findAll } = require("./fake-dom");

const MIN = 60000;

// --- storage ---------------------------------------------------------------

test("loadWallet refuses an empty or a reserved user id", () => {
  const S = makeEnv().dbWalletStorage;
  for (const id of ["", "acg:invalid", "ac:x", "import:x", "i2:x"]) {
    assert.equal(S.loadWallet(id), null, JSON.stringify(id));
  }
});

test("an event with a corrupt ts is kept (ts 0) and survives the next save", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const x = S.loadWallet("bad");
  x.events.push({ id: "bt.1", t: "d", n: 1, ts: 123 }, { id: "bt.2", t: "d", n: 1, ts: NaN });
  assert.equal(S.saveWallet(x), true);
  const kept = S.loadWallet("bad");
  assert.deepEqual(plain(kept.events.map((e) => [e.id, e.ts])), [["bt.1", 123], ["bt.2", 0]]);
  assert.equal(S.appendEvents(kept, [S.newEvent(kept, "d", 1)]), true);
  assert.equal(S.loadWallet("bad").events.length, 3, "the loss is not persisted later either");
});

// --- order: numeric seq, not lexical base36 ---------------------------------

test("same minute: drink seq 35 ('z') before pay seq 36 ('10'), also after a v2 round trip", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const { dbWalletSummary: Sum, dbWalletImportV2: I, dbWalletStorage: S } = w;
  const ts = 1700000000000;
  const x = S.loadWallet("ord");
  x.events = [
    { id: "sc.z", t: "d", n: 1, ts },
    { id: "sc.10", t: "p", ts },
  ];
  assert.equal(Sum.computeSummary(x).unpaid, 0);
  const back = I.decodeImportV2Bytes(I.encodeImportV2Bytes(x, ""));
  assert.equal(Sum.computeSummary(back).unpaid, 0, "the lexical order would put the pay first");
  // The plain order, and undo takes the truly newest one.
  const tie = { events: [{ id: "dev.10", t: "d", n: 1, ts }, { id: "dev.z", t: "d", n: 1, ts }] };
  assert.deepEqual(plain(Sum.computeSummary(tie).eventsEffectiveSorted.map((e) => e.id)), ["dev.z", "dev.10"]);
  const u = S.loadWallet("tie");
  u.events = [{ id: "dev.z", t: "d", n: 1, ts }, { id: "dev.10", t: "d", n: 1, ts }];
  assert.equal(S.undoLastEvent(u).ref, "dev.10");
});

// --- tombstones -------------------------------------------------------------

test("a tombstone also hides a later copy of its id, and wins when listed first", () => {
  const Sum = makeEnv().dbWalletSummary;
  const ts = 1700000000000;
  const undone = [
    { id: "dev.1", t: "d", n: 2, ts },
    { id: "dev.2", t: "x", ref: "dev.1", ts: ts + MIN },
  ];
  assert.equal(Sum.computeSummary({ events: undone }).total, 0);
  // The same id arrives again (an old copy in a merge): still deleted.
  const again = undone.concat([{ id: "dev.1", t: "d", n: 2, ts: ts + 10 * MIN }]);
  assert.deepEqual(plain(pick(Sum.computeSummary({ events: again }))), { total: 0, unpaid: 0, credit: 0 });
  // Out of order: the tombstone comes before its target in the list.
  const first = [
    { id: "dev.4", t: "x", ref: "dev.3", ts: ts + 2 * MIN },
    { id: "dev.3", t: "d", n: 2, ts: ts + MIN },
  ];
  assert.deepEqual(plain(pick(Sum.computeSummary({ events: first }))), { total: 0, unpaid: 0, credit: 0 });
});

const pick = (s) => ({ total: s.total, unpaid: s.unpaid, credit: s.credit });

test("deleteEntry of an entry dated in the future removes it; the tombstone is not dated ahead", async () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const x = S.loadWallet("fut");
  const ahead = Date.now() + 10000000;
  const ev = S.newEvent(x, "d", 1);
  ev.ts = ahead;
  assert.equal(S.appendEvents(x, [ev]), true);
  const { ctx, state } = makeActionsCtx(w, S.loadWallet("fut"));
  assert.equal(await w.dbWalletActions.deleteEntry(ctx, ev.id), true);
  const tomb = state.wallet.events.find((e) => e.t === "x");
  assert.equal(tomb.ref, ev.id);
  assert.ok(tomb.ts <= Date.now(), "no made-up future time");
  assert.equal(w.dbWalletSummary.computeSummary(S.loadWallet("fut")).unpaid, 0);
});

// --- action codes -----------------------------------------------------------

test("an ac: payload carries the address and the key only; an acg: link names no wallet", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const AC = w.dbWalletActionCodes;
  const x = w.dbWalletStorage.loadWallet("max");
  const code = AC.buildActionCode({ type: "g", amount: 3, label: "Drei" });
  assert.deepEqual(Object.keys(AC.buildActionPayload(x, code)).sort(), ["codeId", "key", "v", "walletId"]);
  const payload = { v: 1, t: "d", n: 4, l: "Vier" };
  const hash = AC.encodeGlobalActionHash(payload);
  assert.match(hash, /^acg:/);
  assert.equal(AC.encodeGlobalActionHash(payload), hash, "deterministic: one link per code");
  assert.deepEqual(plain(AC.decodeGlobalActionHash(hash)), payload);
  assert.equal(AC.decodeActionHash(hash), null, "no wallet id, no key");
});

test("normalizeActionCodes: up to the hard limit nothing is trimmed, above it the newest stay", () => {
  const AC = makeEnv().dbWalletActionCodes;
  const codes = (n) =>
    Array.from({ length: n }, (_, i) => AC.buildActionCode({ type: "g", amount: i + 1, label: "Code " + (i + 1) }));
  const seven = AC.normalizeActionCodes(codes(7));
  assert.equal(seven.length, 7, "the soft limit (6) only warns");
  assert.equal(seven._dbwTrimmed, undefined);
  const twelve = AC.normalizeActionCodes(codes(12));
  assert.equal(twelve.length, 10);
  assert.equal(twelve._dbwTrimmed, 2);
});

test("bookActionCode books the stored type and rounded amount; a wrong key or code books nothing", () => {
  const notes = [];
  const w = makeEnv({ deviceKey: "devA" });
  w.dbWalletHelpers.notify = (text, o) => notes.push({ text: String(text), error: !!(o && o.kind === "error") });
  const { dbWalletStorage: S, dbWalletActionCodes: AC, dbWalletImportV2: I } = w;
  const x = S.loadWallet("max");
  const code = AC.buildActionCode({ type: "d", amount: 2, label: "Zwei" });
  code.amount = 3.6;
  x.actionCodes = [code];
  assert.equal(S.saveWallet(x), true);
  // A crafted payload type must not flip the stored drink code into credit.
  I.bookActionCode("max", { codeId: code.id, key: code.key, type: "g" });
  assert.deepEqual(plain(S.loadWallet("max").events.map((e) => [e.t, e.n])), [["d", 4]]);
  I.bookActionCode("max", { codeId: code.id, key: "wrong" });
  I.bookActionCode("max", { codeId: "nope", key: code.key });
  assert.equal(S.loadWallet("max").events.length, 1);
  assert.deepEqual(notes.slice(1).map((n) => n.error), [true, true]);
  assert.match(notes[1].text, /erneuert/);
  assert.match(notes[2].text, /unbekannt/);
});

test("an import updates a global code's label, amount and type but never takes a key", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const { dbWalletStorage: S, dbWalletImportV2: I } = w;
  const now = Date.now();
  const x = S.loadWallet("gina");
  x.globalActionCodes = [
    { id: "global:keep", label: "Lokal", amount: 1, type: "g", key: "LOCALKEY", createdAt: now - 1e5, updatedAt: now - 1e5 },
  ];
  assert.equal(S.saveWallet(x), true);
  const built = I.buildImportedWallet({
    userId: "gina",
    walletId: x.walletId,
    v: 2,
    events: [],
    globalActionCodes: [
      { id: "global:keep", label: "Remote", amount: 5, type: "d", key: "REMOTEKEY", createdAt: now, updatedAt: now },
    ],
  });
  const kept = built.wallet.globalActionCodes.find((c) => c.id === "global:keep");
  assert.deepEqual([kept.label, kept.amount, kept.type], ["Remote", 5, "d"]);
  assert.ok(!kept.key, "global codes carry no key: " + kept.key);
});

// --- summary ----------------------------------------------------------------

test("'s' takes back open drinks only: no credit made up, never below zero", () => {
  const Sum = makeEnv().dbWalletSummary;
  const ts = 1700000000000;
  const credit = Sum.computeSummary({
    events: [
      { id: "dev.1", t: "g", n: 3, ts },
      { id: "dev.2", t: "s", n: 2, ts: ts + MIN },
    ],
  });
  assert.deepEqual([credit.unpaid, credit.credit], [0, 3]);
  const over = Sum.computeSummary({
    events: [
      { id: "dev.1", t: "d", n: 5, ts },
      { id: "dev.2", t: "s", n: 7, ts: ts + MIN },
    ],
  });
  assert.deepEqual([over.unpaid, over.credit], [0, 0]);
});

// --- import links -----------------------------------------------------------

test("parseImportHashPayload reads the same wallet from import:, i2u: and i2:", async () => {
  const w = makeEnv({ deviceKey: "devA" });
  const { dbWalletStorage: S, dbWalletImportV2: I, dbWalletHelpers: H } = w;
  const x = S.loadWallet("max");
  assert.equal(S.appendEvents(x, [S.newEvent(x, "d", 2)]), true);
  const stored = S.loadWallet("max");
  const bytes = I.encodeImportV2Bytes(stored, "");
  const json = JSON.stringify({ userId: "max", walletId: stored.walletId, v: 2, events: plain(stored.events) });
  const links = {
    import: "import:" + H.base64UrlEncode(json),
    i2u: "i2u:" + H.base64UrlEncodeBytes(bytes),
    i2: "i2:" + H.base64UrlEncodeBytes(await H.gzipCompress(bytes)),
  };
  for (const [kind, hash] of Object.entries(links)) {
    const res = await I.parseImportHashPayload(hash);
    assert.equal(res.kind, kind);
    assert.equal(res.remote.walletId, stored.walletId, kind);
    assert.equal(res.remote.userId, "max", kind);
    assert.equal(res.remote.events.length, 1, kind);
  }
});

// --- global codes on wallet.html --------------------------------------------

const acg = (t, n, l) => makeEnv().dbWalletActionCodes.encodeGlobalActionHash({ v: 1, t, n, l });
const saved = (...ids) => (e) => {
  const S = e.dbWalletStorage;
  for (const id of ids) {
    const x = S.loadWallet(id);
    S.appendEvents(x, [S.newEvent(x, "d", 1)]);
  }
};

test("acg: with a wallet open: booked once, a repeat is a duplicate, a decline books nothing", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "anna", storage, seed: saved("anna") });
  const drinks = () => persisted(storage, "anna").events.filter((e) => e.t === "d").map((e) => e.n);
  const hd = acg("d", 4, "Vier");
  w.location.hash = hd;
  await flushHashChanges(w);
  assert.deepEqual(drinks(), [1, 4]);
  assert.equal(w.location.hash, "#anna");
  // The same code again right away (boot vs. hashchange race): not booked twice.
  assert.equal(w.dbWalletUi.applyGlobalActionHash(hd).reason, "duplicate");
  w.confirm = () => false;
  w.location.hash = acg("g", 6, "Sechs");
  await flushHashChanges(w);
  assert.deepEqual(drinks(), [1, 4]);
  assert.equal(persisted(storage, "anna").events.some((e) => e.t === "g"), false);
  assert.equal(w.location.hash, "#anna", "a declined code leaves the address bar");
  assert.equal(w.dbWalletUi.getCurrentUserId(), "anna");
});

test("a valid acg: on a cold start without wallets: the hint, no wallet made", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: acg("d", 2, "Zwei"), storage });
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.match(w.document.getElementById("global-action-message").textContent, /Bitte zuerst ein Wallet importieren oder öffnen/);
  assert.deepEqual(Object.keys(w.dbWalletStorage.getAllWallets()), []);
  for (let i = 0; i < storage.length; i++) assert.doesNotMatch(storage.key(i), /^db-wallet:(?!device$)/);
});

test("a valid acg: with two wallets: the choice lists both, a click books onto that one", async () => {
  const storage = makeStorage();
  let w;
  const booting = bootWalletPage({
    hash: acg("d", 3, "Kiste"),
    storage,
    seed: saved("anna", "berta"),
    beforeBoot: (env) => (w = env),
  });
  const list = await waitFor(() => w && w.document.getElementById("global-action-wallet-select"), "the wallet choice");
  const cards = findAll(list, (el) => el.className === "global-action-card");
  const names = cards.map((c) => findAll(c, (el) => el.className === "global-action-card-title")[0].textContent);
  assert.deepEqual(names, ["anna", "berta"]);
  assert.equal(w.document.body.dataset.noWallet, "1", "nothing open while it asks");
  cards[1].click();
  await booting;
  const S = w.dbWalletStorage;
  assert.deepEqual(plain(S.loadWallet("berta").events.map((e) => [e.t, e.n])), [["d", 1], ["d", 3]]);
  assert.equal(S.loadWallet("anna").events.length, 1);
  assert.equal(w.dbWalletUi.getCurrentUserId(), "berta");
  assert.equal(w.location.hash, "#berta");
});
