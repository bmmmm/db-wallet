// P1.5: re-point `supersedes` on migration and import (plan Anhang A5).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");


const L1 = "legacydev-1700000000000-abc";
const L2 = "legacydev-1700000060000-def";

function legacyEvents() {
  return [
    { id: L1, t: "d", n: 5, ts: 1700000000000 },
    { id: L2, t: "d", n: 2, ts: 1700000060000, supersedes: L1 },
  ];
}

test("A5: migrating a v1 wallet with an edit keeps the total", () => {
  const w = makeEnv();
  const wallet = { userId: "eve", v: 1, events: legacyEvents() };
  assert.equal(w.dbWalletSummary.computeSummary(wallet).total, 2);
  w.dbWalletMigrateV1toV2(wallet);
  assert.equal(w.dbWalletSummary.computeSummary(wallet).total, 2);
  const repl = wallet.events.find((e) => e.oid === L2);
  const orig = wallet.events.find((e) => e.oid === L1);
  assert.equal(repl.supersedes, orig.id);
});

test("import: a legacy edit into an already migrated wallet keeps the total", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const I = w.dbWalletImportV2;
  const walletId = "AAAAAAAAAAAAAAAA";
  // Local: the un-edited legacy entry, migrated on this device.
  const local = { userId: "eve", walletId, v: 1, seq: {}, events: [legacyEvents()[0]], actionCodes: [], devices: [] };
  w.dbWalletMigrateV1toV2(local);
  S.saveWallet(local);
  assert.equal(w.dbWalletSummary.computeSummary(S.loadWallet("eve")).total, 5);
  // Remote: an un-migrated v1 device that edited the entry.
  const built = I.buildImportedWallet({ userId: "eve", walletId, v: 1, events: legacyEvents() });
  assert.equal(built.userId, "eve");
  assert.equal(w.dbWalletSummary.computeSummary(built.wallet).total, 2);
});
