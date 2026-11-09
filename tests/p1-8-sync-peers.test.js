// P1.8: syncPeers hardened against "__proto__" peer keys.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv } = require("./harness");


const PROPS = ["label", "updatedAt", "peerEventCount", "commonEventCount"];

function importFrom(w, deviceId) {
  const I = w.dbWalletImportV2;
  const S = w.dbWalletStorage;
  const built = I.buildImportedWallet({
    userId: "pia",
    walletId: "AAAAAAAAAAAAAAAA",
    v: 2,
    deviceId,
    events: [{ id: "devR.1", t: "d", n: 1, ts: 1700000000000 }],
  });
  S.saveWallet(built.wallet);
  return built;
}

for (const evil of ["__proto__", "constructor", "prototype"]) {
  test(`import with device id ${evil} after a normal import pollutes nothing`, () => {
    const w = makeEnv({ deviceKey: "devA" });
    importFrom(w, "devR"); // first import: syncPeers now persisted as plain JSON
    const built = importFrom(w, evil);
    const fresh = w._eval("({})");
    for (const p of PROPS) {
      assert.equal(p in fresh, false, `Object.prototype.${p} polluted`);
    }
    const peers = built.wallet.syncPeers;
    assert.equal(Object.getPrototypeOf(peers), null, "syncPeers is null-prototype");
    assert.equal(Object.prototype.hasOwnProperty.call(peers, evil), false);
    if (evil === "constructor") {
      assert.equal(typeof w._eval("({})").constructor, "function");
    }
  });
}

test("loadWallet returns syncPeers as a null-prototype map", () => {
  const w = makeEnv({ deviceKey: "devA" });
  importFrom(w, "devR");
  const peers = w.dbWalletStorage.loadWallet("pia").syncPeers;
  assert.equal(Object.getPrototypeOf(peers), null);
  assert.ok(Object.prototype.hasOwnProperty.call(peers, "devR"));
});
