// P2.3: import errors carry a code and map to a message table (no more
// matching on message text); cancelling or failing a hash import returns to
// the open wallet and never leaves the import link in the address bar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");
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
  assert.equal(w._alerts.length, 1, JSON.stringify(w._alerts));
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
