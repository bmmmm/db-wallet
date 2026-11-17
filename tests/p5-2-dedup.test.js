// P5.2: dead and duplicated code. One list of reserved hash prefixes
// (wallet-helpers.js), one user-id normalizer (with its 64-char cap), one
// reading of an `acg:` payload, and import-preview.js loads after the modules
// it uses on every page (its load-order fallbacks are gone).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, plain, REPO } = require("./harness");

const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

test("hash router: a 65+ char id is not a valid user id (same cap as normalizeUserId)", () => {
  const w = makeEnv();
  const R = w.dbWalletHashRouter;
  const long = "a".repeat(70);
  assert.equal(R.classifyHash(long).kind, "none");
  assert.equal(R.classifyHash("a".repeat(64)).kind, "user");
  // A stored wallet with such an id still opens (legacy).
  const S = w.dbWalletStorage;
  const x = S.loadWallet(long);
  S.saveWallet(x);
  assert.equal(R.classifyHash(long).kind, "user");
});

test("reserved hash prefixes live only in wallet-helpers.js", () => {
  const w = makeEnv();
  assert.deepEqual(plain(w.dbWalletHelpers.RESERVED_HASH_PREFIXES), ["ac:", "acg:", "import:", "i2u:", "i2:"]);
  for (const f of ["hash-router.js", "wallet-storage.js"]) {
    assert.doesNotMatch(src(f), /startsWith\("i2u:"\)\s*\|\|/, f + " has its own prefix chain");
    assert.doesNotMatch(src(f), /\[\s*"ac:",\s*"acg:"/, f + " has its own prefix list");
  }
  const S = w.dbWalletStorage;
  for (const p of ["ac:", "acg:", "import:", "i2u:", "i2:"]) {
    assert.ok(!S.ensureNonReservedUserId(p + "x").startsWith(p), p);
  }
});

test("acg: payload is read in one place", () => {
  const w = makeEnv();
  const AC = w.dbWalletActionCodes;
  assert.deepEqual(plain(AC.globalPayloadAction({ v: 1, t: "g", n: 3, l: " Runde " })), {
    type: "g",
    amount: 3,
    label: "Runde",
  });
  assert.equal(AC.globalPayloadAction({ v: 1, t: "x", n: 3 }), null);
  assert.equal(AC.globalPayloadAction({ v: 1, t: "d", n: 101 }), null);
  assert.doesNotMatch(src("wallet-hash-actions.js"), /Math\.round\(payload\.n\)/);
  assert.doesNotMatch(src("wallet-ui.js"), /Math\.round\(payload\.n\)/);
});

test("import-preview.js loads after wallet-helpers.js and wallet-summary.js", () => {
  for (const page of ["index.html", "wallet.html", "preview.html"]) {
    const order = Array.from(src(page).matchAll(/<script src="(?:\.\/)?([^"]+)"/g)).map((m) => m[1]);
    const at = (f) => order.indexOf(f);
    assert.ok(at("import-preview.js") > at("wallet-helpers.js"), page);
    assert.ok(at("import-preview.js") > at("wallet-summary.js"), page);
  }
  assert.doesNotMatch(src("import-preview.js"), /safeParseFallback|loads before wallet-helpers/);
});

test("dead branches are gone", () => {
  assert.doesNotMatch(src("wallet-import-v2.js"), /pending-walletId/);
  assert.doesNotMatch(src("wallet-import-v2.js"), /kind: "ac"/);
  assert.doesNotMatch(src("action-codes.js"), /Fallback: shared helper not loaded/);
  assert.doesNotMatch(src("wallet-export-ui.js"), /qr\.getModule/);
});
