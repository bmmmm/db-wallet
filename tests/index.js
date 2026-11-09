// Entry point for `node --test tests/`. Node 24's test runner treats a directory
// argument as a module path and resolves it to this index.js, so load every
// *.test.js here. (`node --test 'tests/*.test.js'` works too.)
const fs = require("fs");
const path = require("path");

for (const f of fs.readdirSync(__dirname).sort()) {
  if (f.endsWith(".test.js")) require(path.join(__dirname, f));
}
