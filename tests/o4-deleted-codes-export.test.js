// O4 (E4): the deletion list of action codes (wallet.deletedActionCodes,
// id -> deletedAt) travels in the export as codec block "dc" (after "gc",
// before "ck") and in the JSON export. An import unions both lists and then
// filters the codes, so a code deleted on device A is gone on device B after
// B imports A's export; an old export without the block still imports; and an
// export from before the deletion doesn't bring the code back.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const G1 = { id: "global:g1", label: "G1", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 };
const G2 = { id: "global:g2", label: "G2", amount: 3, type: "g", scope: "global", createdAt: 1000, updatedAt: 1000 };

// Device A creates "anna" with two local and two global codes and one drink;
// device B imports A's export, so both share the codes.
function twoDevices() {
  const A = makeEnv({ deviceKey: "devA" });
  const B = makeEnv({ deviceKey: "devB" });
  const SA = A.dbWalletStorage;
  const AC = A.dbWalletActionCodes;
  const wallet = SA.loadWallet("anna");
  wallet.actionCodes.push(AC.buildActionCode({ type: "g", amount: 5, label: "A1" }));
  wallet.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "A2" }));
  wallet.globalActionCodes = [G1, G2];
  SA.appendEvents(wallet, [SA.newEvent(wallet, "d", 1)]);
  importInto(B, A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null));
  return { A, B };
}

function importInto(env, bytes) {
  const I = env.dbWalletImportV2;
  const built = I.buildImportedWallet(I.decodeImportV2Bytes(bytes));
  assert.equal(built.userId, "anna");
  assert.equal(env.dbWalletStorage.saveWallet(built.wallet, { quiet: true }), true);
  return env.dbWalletStorage.loadWallet("anna");
}

const ids = (list) => Array.from(list || [], (c) => c.id).sort();

test("delete on A, export, import on B: the code is gone on B", () => {
  const { A, B } = twoDevices();
  const SA = A.dbWalletStorage;
  const onB = B.dbWalletStorage.loadWallet("anna");
  assert.equal(onB.actionCodes.length, 2);
  assert.equal(onB.globalActionCodes.length, 2);

  const a = SA.loadWallet("anna");
  const localId = a.actionCodes[0].id;
  const keptLocal = a.actionCodes[1].id;
  A.dbWalletActionCodes.removeActionCode(a, localId);
  A.dbWalletActionCodes.removeActionCode(a, "global:g1");
  assert.equal(SA.saveWallet(a), true);

  const b = importInto(B, A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null));
  assert.deepEqual(ids(b.actionCodes), [keptLocal]);
  assert.deepEqual(ids(b.globalActionCodes), ["global:g2"]);
  // B now knows the deletions too, so a later stale export can't revive them.
  assert.ok(localId in b.deletedActionCodes);
  assert.ok("global:g1" in b.deletedActionCodes);
});

test("the block sits after gc and before ck, and the checksum covers it", () => {
  const { A } = twoDevices();
  const SA = A.dbWalletStorage;
  const a = SA.loadWallet("anna");
  A.dbWalletActionCodes.removeActionCode(a, "global:g1", 1700000000000);
  SA.saveWallet(a);
  const bytes = A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null);
  const s = Buffer.from(bytes).toString("latin1");
  const gc = s.lastIndexOf("gc\x01");
  const dc = s.lastIndexOf("dc\x01");
  const ck = s.lastIndexOf("ck\x01");
  assert.ok(gc > 0 && dc > gc && ck > dc, `gc ${gc} < dc ${dc} < ck ${ck}`);
  assert.equal(ck, bytes.length - 7);
  const decoded = A.dbWalletImportV2.decodeImportV2Bytes(bytes);
  assert.equal(plain(decoded.deletedActionCodes)["global:g1"], 1700000000000);
  // A flipped byte inside the dc block fails the checksum.
  const bad = Uint8Array.from(bytes);
  bad[dc + 4] ^= 0x01;
  assert.throws(() => A.dbWalletImportV2.decodeImportV2Bytes(bad), /checksum/i);
});

test("an old export without the block still imports (codes and events)", () => {
  const { A, B } = twoDevices();
  const SA = A.dbWalletStorage;
  const a = SA.loadWallet("anna");
  A.dbWalletActionCodes.removeActionCode(a, "global:g1");
  SA.saveWallet(a);
  const bytes = A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null);
  // Rebuild the payload as an old encoder wrote it: everything up to "dc",
  // then a fresh "ck" over that prefix.
  const s = Buffer.from(bytes).toString("latin1");
  const prefix = Array.from(bytes.subarray(0, s.lastIndexOf("dc\x01")));
  const sum = Number(A.dbWalletHelpers.fnv1a64(prefix) & 0xffffffffn);
  const old = Uint8Array.from([...prefix, 99, 107, 1, (sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]);
  const decoded = A.dbWalletImportV2.decodeImportV2Bytes(old);
  assert.equal(decoded._extWarning, undefined);
  assert.equal(decoded.events.length, 1);
  assert.deepEqual(ids(decoded.globalActionCodes), ["global:g2"]);
  const fresh = makeEnv({ deviceKey: "devC" });
  const c = importInto(fresh, old);
  assert.equal(c.events.length, 1);
  assert.deepEqual(ids(c.globalActionCodes), ["global:g2"]);
  assert.equal(c.actionCodes.length, 2);
});

test("an export from before the deletion does not bring the code back", () => {
  const { A, B } = twoDevices();
  const SA = A.dbWalletStorage;
  const before = A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null);
  const a = SA.loadWallet("anna");
  const localId = a.actionCodes[0].id;
  A.dbWalletActionCodes.removeActionCode(a, localId);
  SA.saveWallet(a);
  // B learns the deletion, then receives the stale export (from A or a third
  // device that still had it).
  importInto(B, A.dbWalletImportV2.encodeImportV2Bytes(SA.loadWallet("anna"), null));
  const b = importInto(B, before);
  assert.ok(!ids(b.actionCodes).includes(localId));
  // And A itself, importing its own stale export, keeps the deletion.
  const back = importInto(A, before);
  assert.ok(!ids(back.actionCodes).includes(localId));
});

test("JSON export carries the deletion list and its import applies it", async () => {
  const { bootWalletPage } = require("./wallet-page");
  const { A, B } = twoDevices();
  const SA = A.dbWalletStorage;
  const a = SA.loadWallet("anna");
  A.dbWalletActionCodes.removeActionCode(a, "global:g2");
  SA.saveWallet(a);
  // The page's own JSON export (Export -> JSON) on A's storage.
  const page = await bootWalletPage({ storage: A.localStorage, hash: "anna" });
  const blobs = [];
  page.dbWalletHelpers.downloadBlob = (blob) => blobs.push(blob);
  page.document.getElementById("btn-export").click();
  page.document.getElementById("btn-export-json").click();
  assert.equal(blobs.length, 1);
  const json = JSON.parse(await blobs[0].text());
  assert.ok("global:g2" in json.deletedActionCodes);
  const I = B.dbWalletImportV2;
  const built = I.buildImportedWallet(json);
  B.dbWalletStorage.saveWallet(built.wallet, { quiet: true });
  assert.deepEqual(ids(B.dbWalletStorage.loadWallet("anna").globalActionCodes), ["global:g1"]);
});

test("a crafted far-future deletion time is clamped to now", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const AC = w.dbWalletActionCodes;
  const out = plain(AC.normalizeDeletedActionCodes({ x: 8e15, y: 5 }));
  assert.ok(out.x <= Date.now(), "clamped: " + out.x);
  assert.equal(out.y, 5);
});
