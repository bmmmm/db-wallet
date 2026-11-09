// P2.1: ac: bookings and hash imports replace the hash (history.replaceState)
// instead of assigning location.hash — no #ac:/#i2: entry stays in the session
// history (Back can't re-book), and switchToUser runs once per import.
// Driven through the real wallet.html boot (tests/wallet-page.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");
const { makeEnv, makeStorage } = require("./harness");

function seedAnnaWithCode(storage) {
  const e = makeEnv({ storage, deviceKey: "devA" });
  const S = e.dbWalletStorage;
  const AC = e.dbWalletActionCodes;
  const wallet = S.loadWallet("anna");
  const code = AC.buildActionCode({ type: "d", amount: 2, label: "Kasten" });
  wallet.actionCodes = [code];
  S.saveWallet(wallet);
  return AC.encodeActionHash(AC.buildActionPayload(wallet, code));
}

function drinks(w, userId) {
  return w.dbWalletStorage
    .loadWallet(userId)
    .events.filter((e) => e.t === "d").length;
}

test("ac: scanned in an open wallet: one booking, no #ac: left in history", async () => {
  const storage = makeStorage();
  const acHash = seedAnnaWithCode(storage);
  const w = await bootWalletPage({ storage, hash: "anna" });
  const nav = w._nav;
  const uidWritesBefore = w._uidWrites();

  w.location.hash = "#" + acHash; // the user opens the scanned link
  const lengthAfterScan = w.history.length;
  await flushHashChanges(w);

  assert.equal(drinks(w, "anna"), 1);
  assert.equal(w.location.hash, "#anna");
  assert.equal(w.history.length, lengthAfterScan, "booking must not push an entry");
  assert.ok(
    !nav.entries.some((u) => u.includes("#ac:")),
    "the #ac: entry is replaced: " + nav.entries.join(" "),
  );
  assert.equal(w._uidWrites() - uidWritesBefore, 1, "switchToUser runs once");

  // Back goes to the wallet entry before the scan and books nothing.
  w.history.back();
  await flushHashChanges(w);
  assert.equal(drinks(w, "anna"), 1, "Back must not re-book the action code");
});

test("ac: on a cold start: booked once, hash replaced, no extra entry", async () => {
  const storage = makeStorage();
  const acHash = seedAnnaWithCode(storage);
  const w = await bootWalletPage({ storage, hash: acHash });
  await flushHashChanges(w);
  assert.equal(drinks(w, "anna"), 1);
  assert.equal(w.location.hash, "#anna");
  assert.equal(w.history.length, 1);
  assert.equal(w._nav.hashchanges, 0, "replaceState fires no hashchange");
});

test("i2: import link opened in an open wallet: switchToUser once, link replaced", async () => {
  const storage = makeStorage();
  const src = makeEnv({ deviceKey: "devR" });
  const SR = src.dbWalletStorage;
  const remote = SR.loadWallet("rita");
  SR.appendEvents(remote, [SR.newEvent(remote, "d", 3)]);
  const I = src.dbWalletImportV2;
  const H = src.dbWalletHelpers;
  const token = H.base64UrlEncodeBytes(await H.gzipCompress(I.encodeImportV2Bytes(remote, null)));

  const w = await bootWalletPage({
    storage,
    hash: "anna",
    seed: (e) => e.dbWalletStorage.saveWallet(e.dbWalletStorage.loadWallet("anna")),
  });
  const uidWritesBefore = w._uidWrites();
  w.location.hash = "#i2:" + token;
  const lengthAfterOpen = w.history.length;
  await flushHashChanges(w);

  assert.equal(w.location.hash, "#rita", JSON.stringify(w._alerts));
  assert.equal(w.history.length, lengthAfterOpen);
  assert.ok(!w._nav.entries.some((u) => u.includes("#i2:")), w._nav.entries.join(" "));
  assert.equal(w._uidWrites() - uidWritesBefore, 1, "switchToUser runs once");
  assert.equal(w.dbWalletUi.getCurrentUserId(), "rita");
  assert.equal(w.dbWalletStorage.loadWallet("rita").events.length, 1);
});
