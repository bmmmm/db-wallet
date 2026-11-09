// P2.4: legacyIdToV2Id only aliases real legacy ids. A compact v2 id whose
// device key contains "-" (base64url, ~12 % of device keys) is not legacy.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");

test("a compact id with device key ab-cd gets no alias", () => {
  const w = makeEnv({ deviceKey: "ab-cd" });
  const I = w.dbWalletImportV2;
  assert.equal(I.legacyIdToV2Id("ab-cd.1"), null);
  assert.equal(I.legacyIdToV2Id("ab-cd.zz"), null);
});

test("real legacy ids still map to their deterministic v2 alias", () => {
  const w = makeEnv();
  const I = w.dbWalletImportV2;
  const alias = I.legacyIdToV2Id("legacydev-1700000000000-abc");
  assert.match(alias, /^legacydev\.[0-9a-z]+$/);
  assert.equal(I.legacyIdToV2Id("legacydev-1700000000000-abc"), alias);
  assert.equal(I.legacyIdToV2Id("plain"), null);
});

test("merge keeps an event whose id equals the would-be alias of an ab-cd id", () => {
  const w = makeEnv({ deviceKey: "ab-cd" });
  const I = w.dbWalletImportV2;
  const H = w.dbWalletHelpers;
  // Before P2.4, "ab-cd.1" seeded the alias "ab.<hash53>" into the seen set,
  // so a genuine remote event with that id was dropped as a duplicate.
  const fakeAlias = "ab." + H.hash53("ab-cd.1").toString(36);
  const merged = I.mergeEvents(
    [{ id: "ab-cd.1", t: "d", n: 1, ts: 1700000000000 }],
    [{ id: fakeAlias, t: "d", n: 1, ts: 1700000060000 }],
  );
  assert.equal(merged.length, 2);
});

test("saving a wallet of device ab-cd round-trips (baseline)", () => {
  const w = makeEnv({ deviceKey: "ab-cd" });
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet("cleo");
  for (let i = 0; i < 3; i++) S.appendEvents(wallet, [S.newEvent(wallet, "d", 1)]);
  assert.equal(S.loadWallet("cleo").events.length, 3);
});
