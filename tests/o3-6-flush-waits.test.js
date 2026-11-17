// O3.6: flushHashChanges waits for the hashchange handlers themselves, not for
// a few quiet timer turns — a handler slower than that window (load peak) must
// still be finished when the helper returns.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");

function seedTwo(e) {
  const S = e.dbWalletStorage;
  for (const id of ["anna", "max"]) {
    const x = S.loadWallet(id);
    S.appendEvents(x, [S.newEvent(x, "d", 1)]);
  }
}

test("flushHashChanges waits for a slow handler", async () => {
  const w = await bootWalletPage({ seed: seedTwo, hash: "anna" });
  const done = [];
  w.addEventListener(
    "hashchange",
    () => new Promise((r) => setTimeout(() => (done.push("slow"), r()), 40)),
  );
  w.location.hash = "#max";
  await flushHashChanges(w);
  assert.deepEqual(done, ["slow"]);
  assert.equal(w.document.getElementById("uid").textContent.includes("max"), true);
});

test("flushHashChanges follows a hashchange queued by a handler", async () => {
  const w = await bootWalletPage({ seed: seedTwo, hash: "anna" });
  let chained = false;
  w.addEventListener("hashchange", async () => {
    await new Promise((r) => setTimeout(r, 1));
    if (!chained) {
      chained = true;
      w.location.hash = "#anna";
    }
  });
  w.location.hash = "#max";
  await flushHashChanges(w);
  assert.equal(w._nav.hashchanges, 2);
  assert.equal(w.location.hash, "#anna");
});
