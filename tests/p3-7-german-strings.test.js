// P3.7: the last English UI strings are German, and the class the action-code
// card uses for its label/amount block has a CSS rule.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

// String literals only (comments may stay English).
function literals(src) {
  return Array.from(src.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g)).map((m) => m[0]);
}

const ENGLISH = [/New action code/i, /\bDevices:/, /Device ID/, /Last seen/];

for (const f of ["action-codes.js", "wallet-sync-ui.js", "wallet-device-ui.js"]) {
  test(`${f}: no English UI strings left`, () => {
    const hits = literals(read(f)).filter((s) => ENGLISH.some((re) => re.test(s)));
    assert.deepEqual(hits, []);
  });
}

test("action-codes.js: German labels are in place", () => {
  const src = read("action-codes.js");
  assert.match(src, /btnAdd\.textContent = "Neuer Action Code"/);
  assert.match(src, /klicke auf „Neuer Action Code“/);
  const sync = read("wallet-sync-ui.js");
  assert.match(sync, /"Geräte: "/);
  assert.match(sync, /Geräte-ID: /);
  assert.match(sync, /Zuletzt gesehen: /);
  assert.match(read("wallet-device-ui.js"), /Geräte-ID: /);
});

test("style.css: .action-code-meta has a rule", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /(^|[\s,}])\.action-code-meta\s*\{[^}]*min-width:\s*0/);
});
