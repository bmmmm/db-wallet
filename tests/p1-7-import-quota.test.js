// P1.7: the import reports a storage failure instead of claiming success.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");

const TODO = { todo: "P1.7" };

function remoteWithEvents(n) {
  const events = [];
  for (let i = 1; i <= n; i++) {
    events.push({ id: "devR." + i.toString(36), t: "d", n: 1, ts: 1700000000000 + i * 60000 });
  }
  return { userId: "rita", walletId: "AAAAAAAAAAAAAAAA", v: 2, events };
}

test("import into full storage ends with exactly one error message", TODO, () => {
  const w = makeEnv({ deviceKey: "devA", quota: 2000 });
  const I = w.dbWalletImportV2;
  w.location.hash = "#i2:something";
  const res = I.importRemoteWallet(remoteWithEvents(200), {});
  assert.equal(w._alerts.length, 1, JSON.stringify(w._alerts));
  assert.ok(!w._alerts[0].includes("importiert ✅"), w._alerts[0]);
  assert.equal(w.location.hash, "#i2:something", "no routing to the wallet");
  assert.equal(res, null);
  assert.equal(w.localStorage.getItem("db-wallet:rita"), null);
});

test("a second failing import also shows exactly one message", TODO, () => {
  const w = makeEnv({ deviceKey: "devA", quota: 2000 });
  const I = w.dbWalletImportV2;
  I.importRemoteWallet(remoteWithEvents(200), {});
  w._alerts.length = 0;
  const res = I.importRemoteWallet(remoteWithEvents(201), {});
  assert.equal(w._alerts.length, 1, JSON.stringify(w._alerts));
  assert.ok(!w._alerts[0].includes("importiert ✅"), w._alerts[0]);
  assert.equal(res, null);
});

test("import with room succeeds with one success message (baseline)", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const I = w.dbWalletImportV2;
  const res = I.importRemoteWallet(remoteWithEvents(3), {});
  assert.equal(res, "rita");
  assert.equal(w._alerts.length, 1);
  assert.ok(w._alerts[0].includes("importiert ✅"));
  assert.equal(w.location.hash, "#rita");
});
