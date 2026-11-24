// P5.5: tombstones ("xt" block) are written compactly — the minute as a running
// delta, id and ref as device index + seq — instead of two strings and the ms
// time each (about 6 instead of about 34 bytes). A decoder that only knows
// "xt" v1 would stop at the block and silently lose every tombstone, so a
// payload with tombstones carries codec 3 (an old app refuses it as "from a
// newer app version"); one without stays codec 2. Old exports (xt v1, exact
// ms) still import.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

const MIN = 60000;
const T = Date.UTC(2026, 10, 1, 18, 0, 0);

// The same wallet, encoded by the encoder before P5.5 (928f6a3: codec 2,
// "xt" v1) — the backward-compatibility fixture.
const OLD_EXPORT =
  "ZGJ3Av8CEAABAgMEBQYHCAkKCwwNDg8HZml4dHVyZQIEZGV2QQRkZXZCvL-gDgUACAlvbGQtZXZ0LTE8BAIAAQEAAAIBBAMBAbIBAgAFeHQBAwZkZXZBLjMGZGV2QS4yvK6awpk0BmRldkIuMgZkZXZBLjGHt-7DmTQGZGV2QS40CW9sZC1ldnQtMYCUysWZNHNwAQRkZXZBZHYBAQRkZXZBAIDaksKZNGNrAXj0TGM";

function fixtureWallet() {
  return {
    userId: "fixture",
    walletId: "AAECAwQFBgcICQoLDA0ODw",
    v: 2,
    seq: { devA: 5, devB: 2 },
    events: [
      { id: "old-evt-1", t: "d", n: 1, ts: T - 3600000 },
      { id: "devA.1", t: "d", n: 2, ts: T },
      { id: "devA.2", t: "d", n: 1, ts: T + 60000 },
      { id: "devB.1", t: "d", n: 3, ts: T + 120000 },
      { id: "devA.3", t: "x", ref: "devA.2", ts: T + 125500 },
      { id: "devB.2", t: "x", ref: "devA.1", ts: T + 3600007 },
      { id: "devA.4", t: "x", ref: "old-evt-1", ts: T + 7200000 },
      { id: "devA.5", t: "p", ts: T + 10800000 },
    ],
    actionCodes: [],
    devices: [{ deviceKey: "devA", symbol: null, lastSeenAt: T }],
  };
}

const tombstonesOf = (decoded) =>
  plain(decoded.events)
    .filter((e) => e.t === "x")
    .map(({ id, ref, ts }) => ({ id, ref, ts }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

const balance = (w, events) => {
  const s = plain(w.dbWalletSummary.computeSummary({ events }));
  return { unpaid: s.unpaid, total: s.total, credit: s.credit };
};

// The index of the "xt" block in an encoded payload: the first 120,116 after
// the header + events (found by decoding them).
function xtOffset(I, bytes) {
  const header = I.decodeV2Header(bytes, 4);
  const ev = I.decodeV2Events(bytes, header.deviceKeys, header.baseTsMin, header.offset);
  assert.deepEqual([bytes[ev.offset], bytes[ev.offset + 1]], [120, 116], "xt is the first block");
  return ev.offset;
}

function withoutChecksum(bytes) {
  const n = bytes.length;
  assert.deepEqual(Array.from(bytes.slice(n - 7, n - 4)), [99, 107, 1], "ck trailer");
  return bytes.slice(0, n - 7);
}

// The payload with a fresh "ck" trailer (after a test edited a byte): codec 3
// without ck counts as cut off.
function resealed(w, bytes) {
  const sum = Number(w.dbWalletHelpers.fnv1a64(bytes) & 0xffffffffn);
  return new Uint8Array([
    ...bytes, 99, 107, 1, (sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255,
  ]);
}

test("an export from before P5.5 (codec 2, xt v1) still imports, exact ms kept", () => {
  const w = makeEnv({ deviceKey: "devC" });
  const I = w.dbWalletImportV2;
  const bytes = w.dbWalletHelpers.base64UrlDecodeBytes(OLD_EXPORT);
  assert.equal(bytes[3], 2);
  const decoded = I.decodeImportV2Bytes(bytes);
  assert.equal(decoded._extWarning, undefined);
  assert.deepEqual(tombstonesOf(decoded), [
    { id: "devA.3", ref: "devA.2", ts: T + 125500 },
    { id: "devA.4", ref: "old-evt-1", ts: T + 7200000 },
    { id: "devB.2", ref: "devA.1", ts: T + 3600007 },
  ]);
  assert.deepEqual(balance(w, decoded.events), balance(w, fixtureWallet().events));
});

test("the same wallet now: codec 3, xt v2, a third smaller, same content to the minute", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const H = w.dbWalletHelpers;
  const bytes = I.encodeImportV2Bytes(fixtureWallet(), "");
  assert.equal(bytes[3], 3);
  const at = xtOffset(I, bytes);
  assert.equal(bytes[at + 2], 2, "xt version 2");
  assert.ok(bytes.length < H.base64UrlDecodeBytes(OLD_EXPORT).length - 30, `${bytes.length} bytes`);
  const decoded = I.decodeImportV2Bytes(bytes);
  assert.equal(decoded._extWarning, undefined);
  // Minute resolution like the events; ids, refs (also the legacy one) exact.
  assert.deepEqual(tombstonesOf(decoded), [
    { id: "devA.3", ref: "devA.2", ts: T + 2 * MIN },
    { id: "devA.4", ref: "old-evt-1", ts: T + 120 * MIN },
    { id: "devB.2", ref: "devA.1", ts: T + 60 * MIN },
  ]);
  assert.deepEqual(balance(w, decoded.events), balance(w, fixtureWallet().events));
  // Every other block still decodes behind it (the ck trailer checked out).
  assert.deepEqual(plain(decoded.devices).map((d) => d.deviceKey), ["devA"]);
  assert.equal(decoded.deviceId, "devA");
});

test("without tombstones the header stays codec 2 (old apps keep reading it)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const wallet = fixtureWallet();
  wallet.events = wallet.events.filter((e) => e.t !== "x");
  const bytes = I.encodeImportV2Bytes(wallet, "");
  assert.equal(bytes[3], 2);
  const header = I.decodeV2Header(bytes, 4);
  const ev = I.decodeV2Events(bytes, header.deviceKeys, header.baseTsMin, header.offset);
  assert.notDeepEqual([bytes[ev.offset], bytes[ev.offset + 1]], [120, 116], "no xt block");
  assert.equal(plain(I.decodeImportV2Bytes(bytes).events).length, 5);
  // A codec newer than 3 is still refused with its own message.
  const newer = bytes.slice();
  newer[3] = 4;
  assert.throws(() => I.decodeImportV2Bytes(newer), (e) => I.importErrorCode(e) === "unsupported-version");
});

test("ids round trip: compact, verbatim, non-canonical, and devices only seen in tombstones", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const wallet = fixtureWallet();
  wallet.events.push(
    // devZ appears only in a tombstone id, devY only in a ref: both join the
    // header's device table.
    { id: "devZ.7", t: "x", ref: "devA.5", ts: T + 11000000 },
    { id: "devA.6", t: "x", ref: "devY.300", ts: T + 11000000 },
    // Not canonical ("01"), with a dot in the key, plain strings: verbatim.
    { id: "devA.01", t: "x", ref: "dev.B.9", ts: T + 11100000 },
    { id: "m-legacy", t: "x", ref: "devB.1", ts: T + 11200000 },
  );
  const bytes = I.encodeImportV2Bytes(wallet, "");
  const header = I.decodeV2Header(bytes, 4);
  for (const k of ["devZ", "devY"]) assert.ok(plain(header.deviceKeys).includes(k), k);
  const got = tombstonesOf(I.decodeImportV2Bytes(bytes)).map(({ id, ref }) => `${id}>${ref}`);
  assert.deepEqual(got.sort(), [
    "devA.01>dev.B.9",
    "devA.3>devA.2",
    "devA.4>old-evt-1",
    "devA.6>devY.300",
    "devB.2>devA.1",
    "devZ.7>devA.5",
    "m-legacy>devB.1",
  ]);
});

test("a tombstone costs at most 8 bytes", () => {
  const w = makeEnv({ deviceKey: "k7f3q9zx2m" });
  const I = w.dbWalletImportV2;
  const base = Date.now() - 30 * 86400000;
  const events = [];
  for (let i = 1; i <= 200; i++) {
    events.push({ id: `k7f3q9zx2m.${i}`, t: "d", n: 1, ts: base + i * 7 * MIN });
  }
  const wallet = { userId: "max", walletId: "AAECAwQFBgcICQoLDA0ODw", v: 2, events: events.slice(), actionCodes: [] };
  const without = I.encodeImportV2Bytes(wallet, "").length;
  for (let i = 1; i <= 100; i++) {
    wallet.events.push({
      id: `k7f3q9zx2m.${200 + i}`,
      t: "x",
      ref: `k7f3q9zx2m.${2 * i}`,
      ts: base + 2 * i * 7 * MIN + 30000,
    });
  }
  const per = (I.encodeImportV2Bytes(wallet, "").length - without) / 100;
  assert.ok(per <= 8, `${per} bytes per tombstone`);
});

test("tombstone times: 0, before every event, out of order — deltas stay >= 0", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const wallet = fixtureWallet();
  wallet.events.push(
    { id: "devA.6", t: "x", ref: "devB.1", ts: 0 },
    { id: "devA.7", t: "x", ref: "devA.5", ts: -5 },
    { id: "devA.8", t: "x", ref: "devA.6", ts: T - 86400000 },
  );
  const decoded = I.decodeImportV2Bytes(I.encodeImportV2Bytes(wallet, ""));
  const byId = Object.fromEntries(tombstonesOf(decoded).map((t) => [t.id, t.ts]));
  assert.equal(byId["devA.6"], 0);
  assert.equal(byId["devA.7"], 0);
  assert.equal(byId["devA.8"], T - 86400000);
  assert.equal(byId["devB.2"], T + 60 * MIN);
});

test("a corrupt device index in xt v2 refuses the payload, no bogus tombstone", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const wallet = fixtureWallet();
  wallet.events = wallet.events.filter((e) => e.t !== "x" || e.id === "devA.3");
  const bytes = withoutChecksum(I.encodeImportV2Bytes(wallet, ""));
  const at = xtOffset(I, bytes);
  // "xt", version 2, count 1, the minute (a multi-byte varint), then the id.
  assert.deepEqual(Array.from(bytes.slice(at, at + 4)), [120, 116, 2, 1]);
  let p = at + 4;
  while (bytes[p] & 0x80) p++;
  p++;
  assert.equal(bytes[p], 1, "devA is device 1");
  const bad = bytes.slice();
  bad[p] = 9; // no ninth device
  assert.throws(() => I.decodeImportV2Bytes(resealed(w, bad)), (e) => I.importErrorCode(e) === "corrupt");
  // A self-referential tombstone (id === ref) is skipped, the block goes on.
  const self = bytes.slice();
  self[p + 2] = 1; // ref: devA.<seq of the id>
  self[p + 3] = self[p + 1];
  const selfDecoded = I.decodeImportV2Bytes(resealed(w, self));
  assert.equal(selfDecoded._extWarning, undefined);
  assert.deepEqual(tombstonesOf(selfDecoded), []);
  assert.equal(selfDecoded.deviceId, "devA");
});

// Export `from`'s wallet and import it on `to` (codec round trip + save).
function sync(from, to, userId) {
  const bytes = from.dbWalletImportV2.encodeImportV2Bytes(from.dbWalletStorage.loadWallet(userId), "");
  const remote = to.dbWalletImportV2.decodeImportV2Bytes(bytes);
  assert.equal(remote._extWarning, undefined);
  const built = to.dbWalletImportV2.buildImportedWallet(remote);
  to.dbWalletStorage.ensureDeviceSeq(built.wallet);
  assert.equal(to.dbWalletStorage.saveWallet(built.wallet), true);
  return bytes;
}

function book(w, userId, type, n) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet(userId);
  const ev = S.newEvent(wallet, type, n);
  assert.equal(S.appendEvents(wallet, [ev]), true);
  return ev;
}

function remove(w, userId, rootId) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet(userId);
  assert.ok(S.appendTombstone(wallet, rootId));
  assert.equal(S.saveWallet(wallet), true);
}

test("two devices delete on both sides and converge; a round trip re-mints nothing", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  const a1 = book(a, "anna", "d", 2);
  const a2 = book(a, "anna", "d", 1);
  book(a, "anna", "g", 10);
  sync(a, b, "anna");
  const b1 = book(b, "anna", "d", 3);
  remove(a, "anna", a1.id);
  remove(b, "anna", a2.id);
  const toA = sync(b, a, "anna");
  assert.equal(toA[3], 3, "B's export carries a tombstone");
  sync(a, b, "anna");
  const wa = a.dbWalletStorage.loadWallet("anna");
  const wb = b.dbWalletStorage.loadWallet("anna");
  const ids = (wallet) => plain(wallet.events).map((e) => e.id).sort();
  assert.deepEqual(ids(wa), ids(wb));
  assert.deepEqual(balance(a, wa.events), balance(b, wb.events));
  assert.deepEqual(balance(a, wa.events), { unpaid: 0, total: 3, credit: 7 });
  const visible = plain(a.dbWalletSummary.applyTombstones(wa.events).effectiveEvents).map((e) => e.id);
  assert.ok(visible.includes(b1.id), "B's drink stays");
  assert.ok(!visible.includes(a1.id) && !visible.includes(a2.id), "both deletions arrived");
  // Another round each way: nothing new (no colliding ids re-minted).
  const before = ids(wa).length;
  sync(b, a, "anna");
  sync(a, b, "anna");
  assert.equal(ids(a.dbWalletStorage.loadWallet("anna")).length, before);
  assert.equal(ids(b.dbWalletStorage.loadWallet("anna")).length, before);
});
