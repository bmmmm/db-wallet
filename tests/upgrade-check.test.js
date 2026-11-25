// scripts/upgrade-check.js: the upgrade scenarios run against this checkout on
// both sides (old = new = REPO), so the script and its harness options stay
// alive. Same release on both sides: codec 3 -> codec 3, nothing may change.
// No test here needs git history.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { REPO, waitFor } = require("./harness");
const { bootWalletPage, PAGE_FILES } = require("./wallet-page");
const os = require("os");
const { runScenarios, exitCode } = require("../scripts/scenarios-upgrade");

let once = null;
const results = () => (once = once || runScenarios({ oldRoot: REPO, newRoot: REPO }));
const row = (rs, id) => {
  const r = rs.find((x) => x.id === id);
  assert.ok(r, `row ${id} missing`);
  return r;
};

test("same release on both sides: every scenario runs and is OK", async () => {
  const rs = await results();
  const ids = rs.map((r) => r.id);
  for (const id of ["S1", "S2a", "S2b", "S3a", "S3b", "S3c", "S3d", "S4", "S4-dc", "S5", "S6-sw", "S6-boot", "S6-buchen", "S6-qr", "S6-codes", "S6-laden", "S6b", "S7", "S8a", "S8b"]) {
    assert.ok(ids.includes(id), `row ${id} missing`);
  }
  assert.deepEqual(rs.filter((r) => r.klasse === "DATENVERLUST"), []);
  assert.deepEqual(rs.filter((r) => r.klasse !== "OK").map((r) => `${r.id}: ${r.beobachtet}`), []);
  for (const r of rs) {
    for (const k of ["id", "pfad", "erwartung", "beobachtet", "klasse"]) assert.equal(typeof r[k], "string", `${r.id}.${k}`);
  }
});

test("S6/S6b boot without an exception; S3b imports codec 3", async () => {
  const rs = await results();
  assert.match(row(rs, "S6-boot").beobachtet, /^Exceptions: keine; #uid „max“$/);
  assert.match(row(rs, "S6b").beobachtet, /^Exceptions: keine; /);
  assert.match(row(rs, "S3b").beobachtet, /^Codec 3; Import ja; /);
});

test("bootWalletPage: root + scriptSource serve the page scripts and the lazy qrcodegen.js", async () => {
  const asked = [];
  const w = await bootWalletPage({
    root: REPO,
    html: fs.readFileSync(path.join(REPO, "wallet.html"), "utf8"),
    scriptSource: (f) => {
      asked.push(f);
      return fs.readFileSync(path.join(REPO, f), "utf8");
    },
    hash: "max",
    seed: (e) => {
      const S = e.dbWalletStorage;
      const res = e.dbWalletActionCodes.createActionCode(S.loadWallet("max"), {
        scope: "local",
        type: "d",
        amount: "2",
        label: "Zwei",
      });
      S.saveWallet(res.wallet);
    },
  });
  assert.deepEqual(asked, PAGE_FILES);
  assert.equal(w.document.getElementById("uid").textContent, "max");
  const panel = w.document.getElementById("action-codes-panel");
  panel.open = true;
  panel.dispatch("toggle");
  await waitFor(() => asked.length > PAGE_FILES.length, "the lazy qrcodegen.js load");
  assert.deepEqual(asked.slice(PAGE_FILES.length), ["qrcodegen.js"]);
});

test("CLI: without a ref it prints the usage and exits 2", () => {
  // spawnSync blocks the whole test process: a stuck child must not hang it.
  const res = spawnSync(process.execPath, [path.join(REPO, "scripts", "upgrade-check.js")], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(res.error);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Aufruf: node scripts\/upgrade-check\.js <alter-ref>/);
  assert.equal(res.stdout, "");
});

test("a scenario that throws is FEHLER and fails the check; HINWEIS alone passes", async () => {
  // An old root without any app file: every scenario throws on its first read.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "db-wallet-upgrade-test-"));
  try {
    const rs = await runScenarios({ oldRoot: empty, newRoot: REPO });
    assert.ok(rs.length > 0);
    for (const r of rs) {
      assert.equal(r.klasse, "FEHLER", `${r.id}: ${r.beobachtet}`);
      assert.match(r.beobachtet, /^Szenario wirft: /);
    }
    assert.equal(exitCode(rs), 1);
  } finally {
    fs.rmdirSync(empty);
  }
  assert.equal(exitCode([{ klasse: "OK" }, { klasse: "HINWEIS" }]), 0);
  assert.equal(exitCode([{ klasse: "OK" }, { klasse: "DATENVERLUST" }]), 1);
});
