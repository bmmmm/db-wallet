// P3.5: wallet.html no longer loads the 75 KB self-check.js on every visit; a
// stub (self-check-loader.js) offers dbWalletSelfCheck.run(), injects
// self-check.js on first use and forwards the result. Load errors surface as
// a rejected promise with a clear message. Both files stay precached.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, makeEnv, DEFAULT_FILES } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const LOADER = read("self-check-loader.js");

// A window with just enough document for the loader. `onAppend(script, win)`
// decides what "loading" the injected script does.
function loaderEnv(onAppend) {
  const appended = [];
  const win = {
    Promise,
    Error,
    document: {
      head: {
        appendChild(el) {
          appended.push(el);
          onAppend(el, win);
        },
      },
      createElement: (tag) => ({ tagName: String(tag).toUpperCase() }),
    },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(LOADER, win, { filename: "self-check-loader.js" });
  return { win, appended };
}

const tick = () => new Promise((r) => setImmediate(r));

test("wallet.html loads the stub, not self-check.js; both stay precached", () => {
  const html = read("wallet.html");
  assert.doesNotMatch(html, /<script src="(\.\/)?self-check\.js"/);
  assert.match(html, /<script src="self-check-loader\.js" defer><\/script>/);
  const sw = read("service-worker.js");
  assert.match(sw, /"\.\/self-check\.js"/);
  assert.match(sw, /"\.\/self-check-loader\.js"/);
});

test("no app code calls dbWalletSelfCheck (safe to load on demand)", () => {
  const html = read("wallet.html");
  const scripts = Array.from(html.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)).map((m) => m[1]);
  for (const f of scripts.filter((f) => f !== "self-check-loader.js")) {
    assert.doesNotMatch(read(f), /dbWalletSelfCheck/, f);
  }
});

test("run() injects self-check.js once and forwards options and result", async () => {
  const { win, appended } = loaderEnv((el, w) => {
    setImmediate(() => {
      w.dbWalletSelfCheck = { run: async (o) => ({ ok: true, checks: [], opts: o }) };
      el.onload();
    });
  });
  const stub = win.dbWalletSelfCheck;
  assert.equal(typeof stub.run, "function");
  const [a, b] = await Promise.all([stub.run({ quiet: true }), stub.run()]);
  assert.equal(appended.length, 1, "loaded once for concurrent calls");
  assert.equal(appended[0].src, "self-check.js");
  assert.equal(a.ok, true);
  assert.equal(a.opts.quiet, true);
  assert.equal(b.ok, true);
  // After loading, the real API replaced the stub; the old stub still works.
  assert.notEqual(win.dbWalletSelfCheck, stub);
  const c = await stub.run();
  assert.equal(c.ok, true);
  assert.equal(appended.length, 1);
});

test("load error: rejected promise with a clear message, a later call retries", async () => {
  let fail = true;
  const { win, appended } = loaderEnv((el, w) => {
    setImmediate(() => {
      if (fail) return el.onerror();
      w.dbWalletSelfCheck = { run: async () => ({ ok: true }) };
      el.onload();
    });
  });
  const stub = win.dbWalletSelfCheck;
  await assert.rejects(stub.run(), /could not load self-check\.js/);
  fail = false;
  const res = await stub.run();
  assert.equal(res.ok, true);
  assert.equal(appended.length, 2);
});

test("script loads but defines no run(): rejected with a clear message", async () => {
  const { win } = loaderEnv((el) => setImmediate(() => el.onload()));
  await assert.rejects(win.dbWalletSelfCheck.run(), /defines no dbWalletSelfCheck\.run/);
});

test("the real self-check.js replaces the stub with its run()", async () => {
  // Loader first, then the real file in the same realm (what the injected
  // <script> does in the browser).
  const w = makeEnv({ files: DEFAULT_FILES.concat(["self-check-loader.js"]) });
  const stub = w.dbWalletSelfCheck;
  assert.equal(typeof stub.load, "function");
  vm.runInContext(read("self-check.js"), w, { filename: "self-check.js" });
  assert.notEqual(w.dbWalletSelfCheck, stub);
  assert.equal(typeof w.dbWalletSelfCheck.run, "function");
  await tick();
});
