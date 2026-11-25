// P2.3: import errors carry a code and map to a message table (no more
// matching on message text); cancelling or failing a hash import returns to
// the open wallet and never leaves the import link in the address bar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");

function exportBytes(w) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("rita");
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 2)]);
  return w.dbWalletImportV2.encodeImportV2Bytes(wallet, null);
}

async function importHash(w, hash, returnToUserId) {
  w.location.hash = "#" + hash;
  return w.dbWalletImportV2.tryImportFromHash({ returnToUserId: returnToUserId || "" });
}

function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    return e && e.code;
  }
  return "no error";
}

test("a payload with a falsified checksum gives the checksum message", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const bytes = exportBytes(src);
  bytes[bytes.length - 1] ^= 0xff;
  const w = makeEnv({ deviceKey: "devA" });
  const token = w.dbWalletHelpers.base64UrlEncodeBytes(bytes);
  const res = await importHash(w, "i2u:" + token);
  assert.equal(res.userId, null);
  assert.equal(w._alerts.length, 1);
  assert.match(w._alerts[0], /Prüfsumme/);
  assert.match(w._alerts[0], /frischen Export/);
  assert.equal(w.location.hash, "", "the import link is removed");
});

test("the same over the gzip i2: path", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const bytes = exportBytes(src);
  bytes[bytes.length - 2] ^= 0x01;
  const w = makeEnv({ deviceKey: "devA" });
  const H = w.dbWalletHelpers;
  const token = H.base64UrlEncodeBytes(await H.gzipCompress(bytes));
  await importHash(w, "i2:" + token);
  assert.match(w._alerts[0], /Prüfsumme/);
});

test("decoder errors carry codes", () => {
  const w = makeEnv({ deviceKey: "devR" });
  const I = w.dbWalletImportV2;
  const bytes = exportBytes(w);
  const badCk = bytes.slice();
  badCk[badCk.length - 1] ^= 0xff;
  assert.equal(codeOf(() => I.decodeImportV2Bytes(badCk)), "checksum");
  const newer = bytes.slice();
  newer[3] = 9;
  assert.equal(codeOf(() => I.decodeImportV2Bytes(newer)), "unsupported-version");
  // Cut inside the header; no ck trailer left to check, so the reader runs out.
  assert.equal(codeOf(() => I.decodeImportV2Bytes(bytes.slice(0, 8))), "truncated");
  assert.equal(codeOf(() => I.decodeImportV2Bytes(new Uint8Array([1, 2, 3, 4, 5]))), "corrupt");
  // A varint that overflows is corrupt data, not an oversized payload.
  assert.equal(
    codeOf(() => I.readVarUint(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]), 0)),
    "corrupt",
  );
});

test("a newer codec version and an oversized link get their own messages", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const bytes = exportBytes(src);
  bytes[3] = 9;
  const w = makeEnv({ deviceKey: "devA" });
  await importHash(w, "i2u:" + w.dbWalletHelpers.base64UrlEncodeBytes(bytes));
  assert.match(w._alerts[0], /neueren App-Version/);

  const w2 = makeEnv({ deviceKey: "devA" });
  await importHash(w2, "i2u:" + "A".repeat(3 * 1024 * 1024));
  assert.match(w2._alerts[0], /zu groß/);
});

test("a failed import in an open wallet returns to it, link removed", async () => {
  const w = await bootWalletPage({
    hash: "anna",
    seed: (e) => e.dbWalletStorage.saveWallet(e.dbWalletStorage.loadWallet("anna")),
  });
  w.location.hash = "#i2:AAAA";
  await flushHashChanges(w);
  // The page stays, so the error goes to the status line, not an alert.
  assert.deepEqual(plain(w._alerts), []);
  assert.match(w.document.getElementById("status-text").textContent, /\S/);
  assert.ok(w.document.getElementById("status-line").classList.contains("is-error"));
  assert.equal(w.location.hash, "#anna");
  assert.equal(w.dbWalletUi.getCurrentUserId(), "anna");
  assert.deepEqual(w._nav.pageLoads, []);
});

test("cancelling the import dialog returns to the open wallet", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const H = src.dbWalletHelpers;
  const token = H.base64UrlEncodeBytes(await H.gzipCompress(exportBytes(src)));
  const w = await bootWalletPage({
    hash: "anna",
    seed: (e) => e.dbWalletStorage.saveWallet(e.dbWalletStorage.loadWallet("anna")),
  });
  w.dbWalletImportPreview = { chooseImportMode: async () => null };
  w.location.hash = "#i2:" + token;
  await flushHashChanges(w);
  assert.deepEqual(w._nav.pageLoads, [], "no jump to index.html");
  assert.equal(w.location.hash, "#anna");
  assert.equal(w.dbWalletUi.getCurrentUserId(), "anna");
  assert.equal(w.dbWalletStorage.findUserIdByWalletId(src.dbWalletStorage.loadWallet("rita").walletId), null);
});

test("cancelling without an open wallet still goes to the start page", async () => {
  const w = makeEnv({ deviceKey: "devA" });
  w.dbWalletImportPreview = { chooseImportMode: async () => null };
  const src = makeEnv({ deviceKey: "devR" });
  const token = src.dbWalletHelpers.base64UrlEncodeBytes(exportBytes(src));
  const res = await importHash(w, "i2u:" + token);
  assert.equal(res.redirectedToPreview, true);
  assert.deepEqual(w._nav.pageLoads, ["https://example.invalid/index.html"]);
});

test("a failed save drops the #i2: link and returns to the open wallet", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const S = src.dbWalletStorage;
  const big = S.loadWallet("rita");
  const evs = [];
  for (let i = 0; i < 200; i++) evs.push(S.newEvent(big, "d", 1));
  S.appendEvents(big, evs);
  const token = src.dbWalletHelpers.base64UrlEncodeBytes(
    src.dbWalletImportV2.encodeImportV2Bytes(big, null),
  );
  const w = makeEnv({ deviceKey: "devA", quota: 2000 });
  w.dbWalletStorage.saveWallet(w.dbWalletStorage.loadWallet("anna"));
  w.location.hash = "#anna";
  const res = await importHash(w, "i2u:" + token, "anna");
  assert.equal(w._alerts.length, 1, JSON.stringify(w._alerts));
  assert.match(w._alerts[0], /nicht gespeichert/);
  assert.equal(w.location.hash, "#anna");
  assert.ok(!w._nav.entries.some((u) => u.includes("#i2u:")), w._nav.entries.join(" "));
  assert.equal(res.userId, null);
});

// A cut-off i2u: link (no gzip CRC) must not import the part before the cut:
// a lost tombstone brings a deleted booking back. Codec 3 (with tombstones)
// always ends in "ck", so a missing trailer means the link was cut; an
// exception inside an extension block rejects the import too. An unknown block
// or block version still stops the parse silently (a newer app's export).
function tombstoneExport() {
  const a = makeEnv({ deviceKey: "devA" });
  const S = a.dbWalletStorage;
  const w = S.loadWallet("tom");
  const e1 = S.newEvent(w, "d", 2);
  const e2 = S.newEvent(w, "d", 3);
  S.appendEvents(w, [e1, e2]);
  S.appendEvents(w, [S.buildTombstoneEvent(w, e2.id)]);
  const bytes = a.dbWalletImportV2.encodeImportV2Bytes(S.loadWallet("tom"), "");
  const I = a.dbWalletImportV2;
  const h = I.decodeV2Header(bytes, 4);
  const ev = I.decodeV2Events(bytes, h.deviceKeys, h.baseTsMin, h.offset);
  return { bytes, eventsEnd: ev.offset };
}

async function importCut(cut) {
  const w = makeEnv({ deviceKey: "devB" });
  const res = await importHash(w, "i2u:" + w.dbWalletHelpers.base64UrlEncodeBytes(cut));
  return { w, res };
}

test("a cut-off i2u: link with tombstones is refused, nothing is saved", async () => {
  const { bytes, eventsEnd } = tombstoneExport();
  assert.equal(bytes[3], 3, "codec 3");
  assert.deepEqual([bytes[eventsEnd], bytes[eventsEnd + 1]], [120, 116], "xt first");
  // Cut inside "xt", right before it, and right before "ck".
  for (const end of [eventsEnd + 5, eventsEnd, bytes.length - 7, bytes.length - 2]) {
    const { w, res } = await importCut(bytes.slice(0, end));
    assert.equal(res.userId, null, "cut at " + end);
    assert.equal(w.localStorage.getItem("db-wallet:tom"), null, "nothing saved, cut at " + end);
    assert.equal(w._alerts.length, 1);
    assert.match(w._alerts[0], /unvollständig/, "cut at " + end);
    assert.equal(w.location.hash, "", "the link is removed");
  }
  // The whole link imports with the deletion.
  const { w, res } = await importCut(bytes);
  assert.equal(res.userId, "tom");
  assert.equal(w.dbWalletSummary.computeSummary(w.dbWalletStorage.loadWallet("tom")).unpaid, 2);
});

test("decode: codec 3 without ck is truncated; a broken extension block throws", () => {
  const w = makeEnv({ deviceKey: "devR" });
  const I = w.dbWalletImportV2;
  const { bytes } = tombstoneExport();
  assert.equal(codeOf(() => I.decodeImportV2Bytes(bytes.slice(0, bytes.length - 7))), "truncated");
  // Codec 2 (no tombstones), ck stripped like an export from before 4c46261,
  // then a "dv" block cut after its count: the block throws, no partial import.
  const plain2 = exportBytes(w);
  assert.equal(plain2[3], 2);
  const noCk = Array.from(plain2.slice(0, plain2.length - 7));
  assert.equal(codeOf(() => I.decodeImportV2Bytes(new Uint8Array([...noCk, 100, 118, 1, 3]))), "truncated");
  // Garbage UTF-8 in a block is corrupt data.
  assert.equal(
    codeOf(() => I.decodeImportV2Bytes(new Uint8Array([...noCk, 115, 112, 1, 2, 0xff, 0xfe]))),
    "corrupt",
  );
  // An unknown block or an unknown version of a known one: a silent stop.
  for (const tail of [[122, 122, 1, 5], [100, 118, 9, 1]]) {
    const decoded = I.decodeImportV2Bytes(new Uint8Array([...noCk, ...tail]));
    assert.equal(decoded.userId, "rita");
    assert.equal(decoded._extWarning, undefined);
  }
});

// An ac: link for a wallet this device doesn't have: declining "zur Startseite
// wechseln?" drops the link like every other declined question, so a reload
// doesn't ask again.
test("declining the ac: question without an open wallet removes the link", async () => {
  const w = makeEnv({ deviceKey: "devA" });
  const asked = [];
  w.confirm = (m) => {
    asked.push(m);
    return false;
  };
  const H = w.dbWalletHelpers;
  const payload = { v: 1, walletId: "AAAAAAAAAAAAAAAA", codeId: "c1", key: "k" };
  const res = await importHash(w, "ac:" + H.base64UrlEncode(JSON.stringify(payload)));
  assert.equal(asked.length, 1);
  assert.match(asked[0], /noch nicht vorhanden/);
  assert.deepEqual(plain(res), { userId: null, redirectedToPreview: false });
  assert.equal(w.location.hash, "");
  assert.ok(!w._nav.entries.some((u) => u.includes("#ac:")), w._nav.entries.join(" "));
  assert.deepEqual(w._nav.pageLoads, []);
});

// A browser without DecompressionStream can't read i2: links. The classic
// export link is gone from the export block, so the message points to the
// JSON backup (the file), which every browser imports.
test("an i2: link in a browser without DecompressionStream points to the JSON backup", async () => {
  const src = makeEnv({ deviceKey: "devR" });
  const H = src.dbWalletHelpers;
  const token = H.base64UrlEncodeBytes(await H.gzipCompress(exportBytes(src)));
  const w = makeEnv({ deviceKey: "devA", globals: { DecompressionStream: undefined } });
  const res = await importHash(w, "i2:" + token);
  assert.equal(res.userId, null);
  assert.equal(w._alerts.length, 1);
  assert.equal(w._alerts[0], w.dbWalletImportV2.IMPORT_ERROR_MESSAGES["unsupported-browser"]);
  assert.doesNotMatch(w._alerts[0], /Export-Link|klassisch/);
  assert.match(w._alerts[0], /„Als JSON herunterladen“/);
  assert.match(w._alerts[0], /„JSON importieren“/);
});
