// P5.3: the card look is defined once. .panel (raised, --panel background)
// and .card (inset, --bg background; .card--flat without the shadow) carry
// border, radius and shadow; the components keep only size and spacing, and
// no rule has to switch the look off again inside a panel. The update notice
// of sw-register.js goes to the status line instead of an inline-styled toast.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, REPO } = require("./harness");
const { makePageDocument, findAll } = require("./fake-dom");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const CSS = read("style.css");

// Top-level and @media-nested rules as {selector, body}; comments dropped.
function rules(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({ selector: m[1].replace(/@media[^{]*$/, "").trim().replace(/\s+/g, " "), body: m[2] });
  }
  return out;
}

const has = (body, prop, value) =>
  new RegExp(`(^|;|\\s)${prop}\\s*:\\s*${value.replace(/[()]/g, "\\$&")}\\s*(;|$)`).test(body);

test("style.css: border + radius + background of the card look live only in .panel/.card", () => {
  const all = rules(CSS);
  const shared = all.find((r) => r.selector === ".panel, .card");
  assert.ok(shared, ".panel, .card rule missing");
  assert.ok(has(shared.body, "border", "1px solid var(--border)"));
  assert.ok(has(shared.body, "border-radius", "12px"));
  assert.ok(has(shared.body, "box-shadow", "var(--shadow)"));
  assert.ok(has(all.find((r) => r.selector === ".panel").body, "background", "var(--panel)"));
  assert.ok(has(all.find((r) => r.selector === ".card").body, "background", "var(--bg)"));
  assert.ok(has(all.find((r) => r.selector === ".card--flat").body, "box-shadow", "none"));
  const copies = all.filter(
    (r) =>
      r.selector !== ".panel, .card" &&
      has(r.body, "border", "1px solid var(--border)") &&
      has(r.body, "border-radius", "12px"),
  );
  assert.deepEqual(copies.map((r) => r.selector), []);
});

test("style.css: no rule switches the card look off again", () => {
  const offs = rules(CSS).filter(
    (r) => has(r.body, "box-shadow", "none") && (has(r.body, "border", "0") || has(r.body, "background", "transparent") || has(r.body, "background", "none")),
  );
  assert.deepEqual(offs.map((r) => r.selector), []);
  // The bare element rules no longer paint a look (a <section> inside a
  // panel, e.g. #theme-section, stays plain).
  for (const sel of ["section", "pre"]) {
    const r = rules(CSS).find((x) => x.selector === sel);
    assert.ok(r, sel);
    assert.doesNotMatch(r.body, /background|border|box-shadow/, sel);
  }
});

function classesOf(html, re) {
  return Array.from(html.matchAll(re)).map((m) => {
    const cls = /\bclass="([^"]*)"/.exec(m[0]);
    return { tag: m[0], classes: cls ? cls[1].split(/\s+/) : [] };
  });
}

test("pages: every block on the page background is a .panel, every inset box a .card", () => {
  const wallet = read("wallet.html");
  const index = read("index.html");
  const preview = read("preview.html");
  // index.html: all five sections; wallet.html: all but #theme-section, which
  // sits inside the (panel) theme <details>.
  for (const s of classesOf(index, /<section\b[^>]*>/g)) assert.ok(s.classes.includes("panel"), s.tag);
  const walletSections = classesOf(wallet, /<section\b[^>]*>/g);
  assert.equal(walletSections.length, 4);
  for (const s of walletSections) {
    if (/id="theme-section"/.test(s.tag)) assert.ok(!s.classes.includes("panel"), s.tag);
    else assert.ok(s.classes.includes("panel"), s.tag);
  }
  for (const html of [wallet, preview]) {
    const stats = classesOf(html, /<div class="stat(?: [^"]*)?"[^>]*>/g);
    assert.equal(stats.length, 3);
    for (const s of stats) assert.ok(s.classes.includes("panel"), s.tag);
  }
  for (const id of ["history-panel", "action-codes-panel", "theme-panel"]) {
    const [d] = classesOf(wallet, new RegExp(`<details id="${id}"[^>]*>`, "g"));
    assert.ok(d && d.classes.includes("panel"), id);
  }
  for (const html of [wallet, index, preview]) {
    for (const p of classesOf(html, /<pre\b[^>]*>/g)) assert.ok(p.classes.includes("card"), p.tag);
  }
  for (const id of ["history-list", "qr-box"]) {
    const [el] = classesOf(wallet, new RegExp(`<[a-z]+ id="${id}"[^>]*>`, "g"));
    assert.ok(el && el.classes.includes("card"), id);
  }
  // The header row is plain on wallet.html, a panel on preview.html.
  assert.match(wallet, /<div class="top-row">/);
  assert.match(preview, /<div class="top-row panel">/);
});

test("JS-built boxes carry the classes too", () => {
  const want = {
    "action-codes-ui.js": [
      /form\.className = "action-code-form card card--flat"/,
      /deleteBox\.className = "action-code-confirm card card--flat"/,
      /card\.className = "action-code-card card"/,
      /notice\.className = "action-codes-notice card card--flat"/,
    ],
    "index-ui.js": [/card\.className = "wallet-card card card--flat"/],
    "wallet-sync-ui.js": [/className = "sync-line panel"/],
    "wallet-messages.js": [/DEFAULT_CLASS = "action-codes-notice card card--flat"/],
    "wallet-hash-actions.js": [/className: "action-codes-notice card card--flat global-action-panel"/],
  };
  for (const [file, res] of Object.entries(want)) {
    const src = read(file);
    for (const re of res) assert.match(src, re, file);
  }
  // Every notice class string in the shipped scripts brings its look along.
  for (const file of ["wallet-storage.js", "index-ui.js", "action-codes-ui.js", "wallet-messages.js", "wallet-hash-actions.js"]) {
    for (const m of read(file).matchAll(/"([^"]*\baction-codes-notice\b[^"]*)"/g)) {
      assert.match(m[1], /\bcard card--flat\b/, `${file}: "${m[1]}"`);
    }
  }
});

function swEnv({ controller = true, page = "wallet.html" } = {}) {
  const swListeners = {};
  const registered = [];
  const navigator = {
    serviceWorker: {
      controller: controller ? {} : null,
      addEventListener(type, fn) {
        (swListeners[type] = swListeners[type] || []).push(fn);
      },
      register(url) {
        registered.push(url);
        return Promise.resolve({});
      },
    },
  };
  const document = makePageDocument(page ? read(page) : "<body></body>");
  const w = makeEnv({
    document,
    files: ["wallet-helpers.js", "sw-register.js"],
    globals: { navigator },
    url: "https://example.invalid/wallet.html#max",
  });
  w._swFire = (type) => (swListeners[type] || []).forEach((fn) => fn({ type }));
  w._registered = registered;
  return w;
}

test("sw-register.js: no inline styles", () => {
  assert.doesNotMatch(read("sw-register.js"), /\.style\b/);
});

test("update notice: sticky in the status line, 'Neu laden' reloads", () => {
  const w = swEnv();
  w._dispatch("load");
  assert.deepEqual(Array.from(w._registered), ["./service-worker.js"]);
  w._swFire("controllerchange");
  const d = w.document;
  const line = d.getElementById("status-line");
  assert.equal(d.getElementById("status-text").textContent, "Neue Version verfügbar.");
  assert.ok(line.classList.contains("is-visible"));
  assert.ok(!line.classList.contains("is-error"));
  const action = d.getElementById("status-action");
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, "Neu laden");
  // A second controllerchange does not show it again; no own toast element.
  w._swFire("controllerchange");
  assert.equal(findAll(d.body, (el) => el.classList.contains("update-toast")).length, 0);
  assert.equal(w._nav.pageLoads.length, 0);
  action.click();
  assert.equal(w._nav.pageLoads.length, 1);
  assert.deepEqual(Array.from(w._alerts), []);
});

test("update notice: nothing on the first install (no previous controller)", () => {
  const w = swEnv({ controller: false });
  w._dispatch("load");
  assert.deepEqual(Array.from(w._registered), ["./service-worker.js"]);
  w._swFire("controllerchange");
  assert.equal(w.document.getElementById("status-text").textContent, "");
  assert.equal(findAll(w.document.body, (el) => el.classList.contains("update-toast")).length, 0);
});

test("update notice without a status line: an own box with the line's classes", () => {
  const w = swEnv({ page: null });
  w._swFire("controllerchange");
  const [bar] = findAll(w.document.body, (el) => el.classList.contains("update-toast"));
  assert.ok(bar, "fallback box missing");
  for (const c of ["status-line", "is-visible"]) assert.ok(bar.classList.contains(c), c);
  const btn = findAll(bar, (el) => el.tagName === "BUTTON")[0];
  assert.equal(btn.textContent, "Neu laden");
  btn.click();
  assert.equal(w._nav.pageLoads.length, 1);
  assert.deepEqual(Array.from(w._alerts), []);
});
