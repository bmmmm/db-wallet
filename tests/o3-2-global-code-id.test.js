// O3.2: a global code that arrives without an id (or with a duplicate one) gets
// a fresh id. It must carry the "global:" prefix like a code built in the UI
// (buildGlobalCode), so ids of both scopes never share one namespace.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");

test("normalizeGlobalActionCodes: a missing or duplicate id gets a global: id", () => {
  const w = makeEnv();
  const api = w.dbWalletActionCodes;
  const out = plain(
    api.normalizeGlobalActionCodes([
      { label: "ohne ID", amount: 2, type: "d", updatedAt: 3 },
      { id: "global:same", label: "erste", amount: 1, type: "d", updatedAt: 2 },
      { id: "global:same", label: "zweite", amount: 1, type: "g", updatedAt: 1 },
    ]),
  );
  assert.equal(out.length, 3);
  for (const c of out) {
    assert.match(c.id, /^global:[A-Za-z0-9_-]+$/, JSON.stringify(c));
    assert.equal(c.scope, "global");
    assert.equal(c.key, undefined);
  }
  assert.equal(new Set(out.map((c) => c.id)).size, 3, "ids stay unique");
  assert.equal(out.find((c) => c.label === "erste").id, "global:same", "an existing id is kept");
});

test("normalizeActionCodes: local ids stay unprefixed", () => {
  const w = makeEnv();
  const out = plain(w.dbWalletActionCodes.normalizeActionCodes([{ amount: 1, type: "d" }]));
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].id, /^global:/);
  assert.ok(out[0].key);
});
