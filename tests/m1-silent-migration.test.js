// M1: a v1 wallet migrates silently on load (loadWallet), no dialog, no
// button. loadWallet migrates in memory only; the migrated wallet lands in
// storage with the next save (wallet.html saves right after the boot). The
// ids stay deterministic (hash53 of the legacy id, migration.js), so two tabs
// or two devices migrate the same data alike, and old exports with legacy ids
// still import.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, plain, REPO } = require("./harness");
const { makePageDocument, find, findAll } = require("./fake-dom");
const { bootWalletPage } = require("./wallet-page");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const KEY = "db-wallet:vera";
const T = Date.UTC(2026, 0, 5, 12, 0, 0);
const L = (i) => `legacydev-${T + i * 60000}-r${i}`;

// A wallet as the v1 app stored it: legacy ids, an edit (supersedes) and a
// delete (tombstone ref) on legacy ids, plus one compact booking the newer
// app made before the migration (old releases mint compact ids on v1 too).
function v1Record(extra) {
  return Object.assign(
    {
      userId: "vera",
      walletId: "AAAAAAAAAAAAAAAA",
      v: 1,
      seq: { devA: 2 },
      events: [
        { id: L(0), t: "d", n: 3, ts: T },
        { id: L(1), t: "d", n: 2, ts: T + 60000 },
        { id: L(2), t: "d", n: 5, ts: T + 120000, supersedes: L(0) },
        { id: L(3), t: "x", ref: L(1), ts: T + 180000 },
        { id: L(4), t: "g", n: 10, ts: T + 240000 },
        { id: "devA.1", t: "d", n: 1, ts: T + 300000 },
      ],
      actionCodes: [],
      devices: [],
    },
    extra || {},
  );
}

function seedV1(storage, record) {
  const raw = JSON.stringify(record || v1Record());
  storage.setItem(KEY, raw);
  return raw;
}

const LEGACY_COUNT = 6;

function summaryOf(w, wallet) {
  const s = w.dbWalletSummary.computeSummary(plain(wallet));
  return { total: s.total, unpaid: s.unpaid, credit: s.credit };
}

// The balance of the stored v1 data as the v1 fold computes it (legacy refs).
const V1_SUMMARY = summaryOf(makeEnv(), v1Record());

function stored(storage) {
  return JSON.parse(storage.getItem(KEY));
}

function assertMigrated(w, events, label) {
  const parse = w.dbWalletHelpers.parseCompactEventId;
  for (const e of events) {
    assert.ok(parse(e.id), `${label}: id ${e.id} is compact`);
    if (e.ref) assert.ok(parse(e.ref), `${label}: ref ${e.ref} is compact`);
    if (e.supersedes) assert.ok(parse(e.supersedes), `${label}: supersedes ${e.supersedes} is compact`);
  }
}

function assertNoDuplicates(events, label) {
  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ids ${ids.join(" ")}`);
  const oids = events.map((e) => e.oid).filter(Boolean);
  assert.equal(new Set(oids).size, oids.length, `${label}: an old event came back twice`);
}

// legacy id -> migrated id, from the `oid` the migration keeps.
function idsByOid(events) {
  const out = {};
  for (const e of events) if (e.oid) out[e.oid] = e.id;
  return out;
}

// --- loadWallet ---------------------------------------------------------------

test("loadWallet migrates a v1 wallet in memory and leaves the store alone", () => {
  const storage = makeStorage();
  const raw = seedV1(storage);
  const w = makeEnv({ storage, deviceKey: "devA" });
  const wallet = w.dbWalletStorage.loadWallet("vera");
  assert.equal(wallet.v, 2);
  assert.equal(wallet.events.length, LEGACY_COUNT);
  assertMigrated(w, wallet.events, "loaded");
  assertNoDuplicates(wallet.events, "loaded");
  assert.equal(storage.getItem(KEY), raw, "loading does not write");
  // The same data migrates to the same ids on every load.
  const again = w.dbWalletStorage.loadWallet("vera");
  assert.deepEqual(plain(again.events), plain(wallet.events));
});

test("tombstone ref and edit supersedes follow the new ids; the balance stays", () => {
  const storage = makeStorage();
  seedV1(storage);
  const w = makeEnv({ storage, deviceKey: "devA" });
  const wallet = w.dbWalletStorage.loadWallet("vera");
  const byOid = idsByOid(wallet.events);
  const tomb = wallet.events.find((e) => e.oid === L(3));
  const edit = wallet.events.find((e) => e.oid === L(2));
  assert.equal(tomb.ref, byOid[L(1)]);
  assert.equal(edit.supersedes, byOid[L(0)]);
  assert.equal(wallet.events.find((e) => e.id === "devA.1").oid, undefined, "a compact id stays as it is");
  assert.deepEqual(summaryOf(w, wallet), V1_SUMMARY);
  assert.deepEqual(V1_SUMMARY, { total: 6, unpaid: 0, credit: 4 });
});

// --- saveWallet reconcile (risk 1) ---------------------------------------------

test("a booking saves the migration; the stored v1 events do not come back", () => {
  const storage = makeStorage();
  seedV1(storage);
  const w = makeEnv({ storage, deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("vera");
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
  const after = stored(storage);
  assert.equal(after.v, 2);
  assert.equal(after.events.length, LEGACY_COUNT + 1);
  assertMigrated(w, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.deepEqual(after.events.map((e) => e.id).sort(), plain(wallet.events).map((e) => e.id).sort());
  assert.deepEqual(summaryOf(w, after), { total: 7, unpaid: 0, credit: 3 });
  assert.deepEqual(plain(w._alerts), []);
});

test("an old tab deletes on the v1 record after the load: the save keeps the delete", () => {
  // This tab loaded (and migrated) first; then a tab of the previous release,
  // which still holds the legacy ids, wrote a delete of the edited entry —
  // its tombstone refers to the legacy root id.
  const storage = makeStorage();
  seedV1(storage);
  const w = makeEnv({ storage, deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("vera");
  const rec = v1Record();
  rec.events.push({ id: "devA.2", t: "x", ref: L(0), ts: T + 360000 });
  rec.seq = { devA: 3 };
  storage.setItem(KEY, JSON.stringify(rec));

  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
  const after = stored(storage);
  assert.equal(after.events.length, LEGACY_COUNT + 2);
  assertMigrated(w, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  const oldTomb = after.events.find((e) => e.id === "devA.2");
  assert.equal(oldTomb.ref, idsByOid(after.events)[L(0)], "the delete points at the migrated root");
  // 6 - 5 (deleted entry) + 1 (new drink)
  assert.equal(summaryOf(w, after).total, 2);
  assert.equal(summaryOf(w, S.loadWallet("vera")).total, 2);
});

// --- two tabs (risk 2) ---------------------------------------------------------

test("two tabs on a v1 store: both load, both book, nothing doubles", () => {
  const storage = makeStorage();
  seedV1(storage);
  const tab1 = makeEnv({ storage, deviceKey: "devA" });
  const tab2 = makeEnv({ storage });
  const A = tab1.dbWalletStorage.loadWallet("vera");
  const B = tab2.dbWalletStorage.loadWallet("vera");
  assert.deepEqual(plain(A.events), plain(B.events), "both tabs migrate alike");
  const SA = tab1.dbWalletStorage;
  const SB = tab2.dbWalletStorage;
  assert.equal(SA.appendEvents(A, [SA.newEvent(A, "d", 1)]), true);
  assert.equal(SB.appendEvents(B, [SB.newEvent(B, "g", 5)]), true);
  const after = stored(storage);
  assert.equal(after.events.length, LEGACY_COUNT + 2);
  assertMigrated(tab1, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.deepEqual(idsByOid(after.events), idsByOid(A.events));
  assert.deepEqual(summaryOf(tab1, after), { total: 7, unpaid: 0, credit: 8 });
  assert.deepEqual(plain(tab1._alerts).concat(plain(tab2._alerts)), []);
});

test("two tabs on a v1 store without walletId: the second tab joins the first", () => {
  const storage = makeStorage();
  const rec = v1Record();
  delete rec.walletId;
  seedV1(storage, rec);
  const tab1 = makeEnv({ storage, deviceKey: "devA" });
  const tab2 = makeEnv({ storage });
  const A = tab1.dbWalletStorage.loadWallet("vera");
  const B = tab2.dbWalletStorage.loadWallet("vera");
  const SA = tab1.dbWalletStorage;
  const SB = tab2.dbWalletStorage;
  assert.equal(SA.appendEvents(A, [SA.newEvent(A, "d", 1)]), true);
  assert.equal(SB.appendEvents(B, [SB.newEvent(B, "g", 5)]), true, "not refused as a reset elsewhere");
  assert.equal(B.walletId, A.walletId);
  const after = stored(storage);
  assert.equal(after.walletId, A.walletId);
  assert.equal(after.events.length, LEGACY_COUNT + 2);
  assertMigrated(tab1, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.deepEqual(plain(tab1._alerts).concat(plain(tab2._alerts)), []);
});

test("a v1 store without walletId: an old tab saves first with legacy ids, this tab joins it", () => {
  const storage = makeStorage();
  const rec = v1Record();
  delete rec.walletId;
  seedV1(storage, rec);
  const w = makeEnv({ storage, deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("vera");
  // The previous release (no silent migration) opened the same record,
  // minted its own walletId, booked and saved — still legacy ids.
  const old = v1Record({ walletId: "BBBBBBBBBBBBBBBB", seq: { devA: 3 } });
  old.events.push({ id: "devA.2", t: "d", n: 1, ts: T + 360000 });
  storage.setItem(KEY, JSON.stringify(old));

  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true, "not refused as a reset elsewhere");
  assert.equal(wallet.walletId, "BBBBBBBBBBBBBBBB");
  const after = stored(storage);
  assert.equal(after.walletId, "BBBBBBBBBBBBBBBB");
  assert.equal(after.events.length, LEGACY_COUNT + 2);
  assertMigrated(w, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.deepEqual(plain(w._alerts), []);
});

// --- two devices (risk 4) ------------------------------------------------------

function importBytes(env, bytes) {
  const I = env.dbWalletImportV2;
  const built = I.buildImportedWallet(I.decodeImportV2Bytes(bytes));
  assert.equal(built.userId, "vera");
  assert.equal(env.dbWalletStorage.saveWallet(built.wallet, { quiet: true }), true);
  return env.dbWalletStorage.loadWallet("vera");
}

test("two devices migrate the same v1 data alike and import each other without duplicates", () => {
  const devices = ["devA", "devB"].map((deviceKey) => {
    const storage = makeStorage();
    seedV1(storage);
    const w = makeEnv({ storage, deviceKey });
    const S = w.dbWalletStorage;
    const wallet = S.loadWallet("vera");
    S.ensureDeviceSeq(wallet);
    assert.equal(S.saveWallet(wallet), true);
    assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
    return { w, storage };
  });
  const [a, b] = devices;
  const legacyA = idsByOid(stored(a.storage).events);
  assert.deepEqual(idsByOid(stored(b.storage).events), legacyA, "same migrated ids on both devices");
  assertMigrated(a.w, stored(a.storage).events, "device A");

  const exportOf = (d) => d.w.dbWalletImportV2.encodeImportV2Bytes(d.w.dbWalletStorage.loadWallet("vera"), null);
  const bytesA = exportOf(a);
  const bytesB = exportOf(b);
  const onB = importBytes(b.w, bytesA);
  const onA = importBytes(a.w, bytesB);
  for (const [label, wallet] of [["A", onA], ["B", onB]]) {
    assert.equal(wallet.events.length, LEGACY_COUNT + 2, label);
    assertMigrated(a.w, wallet.events, label);
    assertNoDuplicates(wallet.events, label);
  }
  assert.deepEqual(plain(onA.events).map((e) => e.id).sort(), plain(onB.events).map((e) => e.id).sort());
  assert.deepEqual(summaryOf(a.w, onA), summaryOf(b.w, onB));
  assert.equal(summaryOf(a.w, onA).total, 8);
});

// --- old exports (risk 5) ------------------------------------------------------

// A device whose stored v1 wallet was migrated by a booking.
function migratedDevice() {
  const storage = makeStorage();
  seedV1(storage);
  const w = makeEnv({ storage, deviceKey: "devC" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("vera");
  assert.equal(S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]), true);
  return { w, storage };
}

async function importHash(env, hash) {
  const I = env.dbWalletImportV2;
  const parsed = await I.parseImportHashPayload(hash);
  assert.ok(parsed, "a recognized import hash");
  const built = I.buildImportedWallet(parsed.remote);
  assert.equal(built.userId, "vera");
  assert.equal(env.dbWalletStorage.saveWallet(built.wallet, { quiet: true }), true);
  return env.dbWalletStorage.loadWallet("vera");
}

const IMPORT_JSON_HASH = "import:" + Buffer.from(JSON.stringify(v1Record()), "utf8").toString("base64url");

async function i2HashOfV1() {
  // The v1 app's export: the codec writes the legacy ids verbatim.
  const w = makeEnv();
  const bytes = w.dbWalletImportV2.encodeImportV2Bytes(v1Record(), null);
  const gz = await w.dbWalletHelpers.gzipCompress(bytes);
  return "i2:" + w.dbWalletHelpers.base64UrlEncodeBytes(gz);
}

for (const [label, makeHash] of [
  ["#import: JSON", async () => IMPORT_JSON_HASH],
  ["i2 link", i2HashOfV1],
]) {
  test(`an old ${label} with legacy ids imports on a new device, migrated`, async () => {
    const w = makeEnv({ deviceKey: "devC" });
    const wallet = await importHash(w, await makeHash());
    assert.equal(wallet.events.length, LEGACY_COUNT);
    assertMigrated(w, wallet.events, "imported");
    assertNoDuplicates(wallet.events, "imported");
    assert.deepEqual(summaryOf(w, wallet), V1_SUMMARY);
  });

  test(`an old ${label} with legacy ids adds nothing to the migrated wallet`, async () => {
    const { w } = migratedDevice();
    const before = plain(w.dbWalletStorage.loadWallet("vera").events).map((e) => e.id).sort();
    const wallet = await importHash(w, await makeHash());
    assert.deepEqual(plain(wallet.events).map((e) => e.id).sort(), before);
    assertNoDuplicates(wallet.events, "after import");
    assert.equal(summaryOf(w, wallet).total, 7);
  });

  test(`an old ${label} imports into a store that still holds the v1 record`, async () => {
    const storage = makeStorage();
    seedV1(storage);
    const w = makeEnv({ storage, deviceKey: "devC" });
    const wallet = await importHash(w, await makeHash());
    assert.equal(wallet.events.length, LEGACY_COUNT);
    assertMigrated(w, stored(storage).events, "stored");
    assertNoDuplicates(stored(storage).events, "stored");
    assert.deepEqual(summaryOf(w, wallet), V1_SUMMARY);
  });
}

// --- index.html (risk 6) -------------------------------------------------------

const INDEX_HTML = read("index.html");
const INDEX_SKIP = new Set(["theme.js", "import-preview.js", "sw-register.js"]);
const INDEX_FILES = Array.from(INDEX_HTML.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
  .map((m) => m[1])
  .filter((f) => !INDEX_SKIP.has(f));
const settle = () => new Promise((r) => setTimeout(r, 0));

async function bootIndex(storage) {
  const document = makePageDocument(INDEX_HTML);
  const w = makeEnv({ storage, deviceKey: "devA", document, files: INDEX_FILES, url: "https://example.invalid/index.html" });
  await Promise.all(document._fire("DOMContentLoaded"));
  await settle();
  const dlg = document.getElementById("confirm-dialog");
  dlg.showModal = () => {
    dlg.open = true;
  };
  dlg.close = () => {
    dlg.open = false;
    dlg.dispatch("close");
  };
  return w;
}

const cardOf = (w, name) =>
  findAll(w.document.getElementById("existing-users"), (el) => el.classList.contains("wallet-card")).find(
    (c) => find(c, (el) => el.classList.contains("wallet-card-name")).textContent === name,
  );
const textIn = (card, cls) => find(card, (el) => el.classList.contains(cls)).textContent;

test("index.html: list, backup and 'Alle löschen' work with a v1 wallet in the store", async () => {
  const storage = makeStorage();
  const raw = seedV1(storage);
  const seed = makeEnv({ storage, deviceKey: "devA" });
  const anna = seed.dbWalletStorage.loadWallet("anna");
  seed.dbWalletStorage.appendEvents(anna, [seed.dbWalletStorage.newEvent(anna, "d", 2)]);

  const w = await bootIndex(storage);
  assert.equal(textIn(cardOf(w, "vera"), "wallet-card-summary"),
    `Getrunken: ${V1_SUMMARY.total} · Offen: ${V1_SUMMARY.unpaid} · Guthaben: ${V1_SUMMARY.credit}`);
  assert.equal(textIn(cardOf(w, "anna"), "wallet-card-summary"), "Getrunken: 2 · Offen: 2 · Guthaben: 0");
  assert.equal(storage.getItem(KEY), raw, "listing the wallets writes nothing");

  // The backup from the delete question: the migrated wallet, importable.
  const blobs = [];
  w.dbWalletHelpers.downloadBlob = (blob, name) => {
    blobs.push({ blob, name });
    return true;
  };
  find(cardOf(w, "vera"), (el) => el.classList.contains("wallet-delete")).click();
  w.document.getElementById("confirm-extra").click();
  assert.equal(blobs.length, 1);
  assert.match(blobs[0].name, /^db-wallet-vera-\d{4}-\d{2}-\d{2}-backup\.json$/);
  const json = JSON.parse(await blobs[0].blob.text());
  assert.equal(json.events.length, LEGACY_COUNT);
  assertMigrated(w, json.events, "backup");
  w.document.getElementById("confirm-cancel").click();
  await settle();
  const other = makeEnv({ deviceKey: "devB" });
  const built = other.dbWalletImportV2.buildImportedWallet(json);
  assert.equal(built.userId, "vera");
  assert.deepEqual(summaryOf(other, built.wallet), V1_SUMMARY);
  assertNoDuplicates(built.wallet.events, "backup import");
  assert.equal(storage.getItem(KEY), raw, "the cancelled delete kept the wallet");

  w.document.getElementById("btn-nuke-all").click();
  w.document.getElementById("confirm-ok").click();
  await settle();
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem("db-wallet:anna"), null);
  assert.equal(w.document.getElementById("existing-users-section").hidden, true);
});

// --- wallet.html ---------------------------------------------------------------

test("wallet.html: the first open saves the migration, without asking", async () => {
  const storage = makeStorage();
  seedV1(storage);
  const w = await bootWalletPage({ storage, hash: "vera" });
  const after = stored(storage);
  assert.equal(after.v, 2);
  assert.equal(after.events.length, LEGACY_COUNT);
  assertMigrated(w, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.equal(w.document.getElementById("total").textContent, String(V1_SUMMARY.total));
  w.document.getElementById("mode-raw").click();
  const shown = JSON.parse(w.document.getElementById("history").textContent);
  assertMigrated(w, shown.events, "raw view");
  w.document.getElementById("btn-drink").click();
  assert.equal(stored(storage).events.length, LEGACY_COUNT + 1);
  assertNoDuplicates(stored(storage).events, "after a drink");
});

test("wallet.html: storage full at the migration save — nothing lost, the page boots", async () => {
  const storage = makeStorage();
  const raw = seedV1(storage);
  // The v1 record fits, the migrated one (every event keeps its `oid`) does not.
  storage.quota = raw.length;
  const w = await bootWalletPage({ storage, hash: "vera" });
  const doc = w.document;
  assert.equal(doc.getElementById("uid").textContent, "vera");
  assert.equal(doc.getElementById("total").textContent, String(V1_SUMMARY.total));
  assert.equal(storage.getItem(KEY), raw, "the stored v1 record is untouched");
  assert.match(doc.getElementById("status-text").textContent, /Konnte nicht speichern/);
  // Every later load migrates the same record to the same ids again.
  const reloaded = makeEnv({ storage }).dbWalletStorage.loadWallet("vera");
  doc.getElementById("mode-raw").click();
  const shown = JSON.parse(doc.getElementById("history").textContent);
  assert.deepEqual(shown.events.map((e) => e.id), plain(reloaded.events).map((e) => e.id));
  assertMigrated(w, shown.events, "in memory");

  // Space again: the next booking stores the migrated wallet completely.
  storage.quota = Infinity;
  doc.getElementById("btn-drink").click();
  const after = stored(storage);
  assert.equal(after.events.length, LEGACY_COUNT + 1);
  assertMigrated(w, after.events, "stored");
  assertNoDuplicates(after.events, "stored");
  assert.equal(summaryOf(w, after).total, V1_SUMMARY.total + 1);
});

test("the migration UI is gone: no button, no version label, no prompt", () => {
  const hits = (f, re) => (read(f).match(re) || []).join(" ");
  assert.equal(hits("wallet.html", /btn-migrate|wallet-version/g), "");
  assert.equal(hits("style.css", /#btn-migrate|\.wallet-version/g), "");
  assert.equal(hits("wallet-ui.js", /prompt\(/g), "");
  assert.equal(
    hits("wallet-ui.js", /runMigrationDialog|migrateWalletNow|needsMigration|getWalletVersion|btnMigrate|elWalletVersion|updateHeaderUi/g),
    "",
  );
  assert.equal(hits("wallet-export-ui.js", /needsMigration|runMigrationDialog|nach Migration/g), "");
  assert.equal(hits("wallet-actions.js", /updateHeaderUi/g), "");
  // The migration itself stays: the import merge and loadWallet use it.
  assert.match(read("migration.js"), /window\.dbWalletMigrateV1toV2 = /);
});
