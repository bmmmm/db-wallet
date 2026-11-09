// P1.3: global action codes survive the import (plan Anhang A4).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");


// Export written by the encoder at ff68cd5/2bd98b0: the "gc" block carries an
// invented key "OLDGLOBALKEY" for global:g1; "ac" carries local code loc1.
const OLD_EXPORT_B64 =
  "ZGJ3AgACDAAAAAAAAAAAAAAAAARvbGdhAQZkZXZPbGSVqsENAQAEAgABYWMCAQRsb2MxAUwDC0xPQ0FMS0VZMTIzgNCV_7wxgNCV_7wxAHNwAQZkZXZPbGRnYwEBCWdsb2JhbDpnMQFHBAxPTERHTE9CQUxLRVmA0JX_vDGA0JX_vDEBY2sBU-iEqg";

function seedGlobal(S) {
  const wallet = S.loadWallet("anna");
  wallet.globalActionCodes = [
    { id: "global:x1", label: "G1", amount: 2, type: "d", scope: "global", createdAt: 1000, updatedAt: 1000 },
  ];
  S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  return wallet;
}

test("A4: scope survives export -> import on a second device and back", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  const wallet = seedGlobal(a.dbWalletStorage);

  const toB = b.dbWalletImportV2.decodeImportV2Bytes(
    a.dbWalletImportV2.encodeImportV2Bytes(wallet, null),
  );
  const builtB = b.dbWalletImportV2.buildImportedWallet(toB);
  assert.equal(builtB.wallet.globalActionCodes[0].scope, "global");
  b.dbWalletStorage.saveWallet(builtB.wallet);

  const back = a.dbWalletImportV2.decodeImportV2Bytes(
    b.dbWalletImportV2.encodeImportV2Bytes(b.dbWalletStorage.loadWallet(builtB.userId), null),
  );
  const builtA = a.dbWalletImportV2.buildImportedWallet(back);
  assert.equal(builtA.userId, "anna");
  assert.equal(builtA.wallet.globalActionCodes.length, 1);
  assert.equal(builtA.wallet.globalActionCodes[0].scope, "global");
  assert.equal(builtA.wallet.globalActionCodes[0].id, "global:x1");
});

test("A4: two exports of the same wallet are byte-identical", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const wallet = seedGlobal(a.dbWalletStorage);
  const I = a.dbWalletImportV2;
  const x = Buffer.from(I.encodeImportV2Bytes(wallet, null)).toString("hex");
  const y = Buffer.from(I.encodeImportV2Bytes(wallet, null)).toString("hex");
  assert.equal(x, y);
});

test("global codes carry no key after decode", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const wallet = seedGlobal(a.dbWalletStorage);
  const I = a.dbWalletImportV2;
  const decoded = I.decodeImportV2Bytes(I.encodeImportV2Bytes(wallet, null));
  const g = decoded.globalActionCodes[0];
  assert.equal(g.scope, "global");
  assert.ok(!g.key, "no key on a global code");
});

test("an old export (gc with invented key) still decodes; key dropped", () => {
  const w = makeEnv({ deviceKey: "devZ" });
  const I = w.dbWalletImportV2;
  const decoded = I.decodeImportV2Bytes(new Uint8Array(Buffer.from(OLD_EXPORT_B64, "base64url")));
  assert.equal(decoded.userId, "olga");
  assert.equal(decoded.events.length, 1);
  assert.equal(decoded.actionCodes[0].key, "LOCALKEY123");
  const g = decoded.globalActionCodes[0];
  assert.equal(g.id, "global:g1");
  assert.equal(g.amount, 4);
  assert.equal(g.type, "d");
  assert.equal(g.scope, "global");
  assert.ok(!g.key);
  const built = I.buildImportedWallet(decoded);
  assert.equal(built.wallet.globalActionCodes[0].scope, "global");
  assert.ok(!built.wallet.globalActionCodes[0].key);
});

test("old export baseline: decodes at all (green before and after)", () => {
  const w = makeEnv({ deviceKey: "devZ" });
  const I = w.dbWalletImportV2;
  const decoded = I.decodeImportV2Bytes(new Uint8Array(Buffer.from(OLD_EXPORT_B64, "base64url")));
  assert.equal(decoded.globalActionCodes.length, 1);
  assert.equal(decoded.actionCodes.length, 1);
});
