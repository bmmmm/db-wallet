// P3.1: theme default, contrast, focus ring, theme-color / color-scheme.
// Contrast is computed (WCAG 2.x relative luminance) from the actual values in
// themes.css, for every theme: text colours >= 4.5:1 against both surfaces
// (--bg, --panel), the focus ring (--text) >= 3:1.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const THEMES_CSS = read("themes.css");
const STYLE_CSS = read("style.css");

function parseDecls(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim().toLowerCase();
  }
  return out;
}

function parseThemes(css) {
  const themes = {};
  for (const m of css.matchAll(/:root\[data-theme="([^"]+)"\][^{]*\{([^}]*)\}/g)) {
    themes[m[1]] = parseDecls(m[2]);
  }
  return themes;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  assert.match(h, /^[0-9a-f]{6}$/, "expected #rrggbb, got " + hex);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const THEMES = parseThemes(THEMES_CSS);
const NAMES = ["Lilac Carbon", "Teal Ember", "Slate Sunrise", "Paper Mint", "Peach Cloud"];
const TEXT_VARS = ["--text", "--muted", "--accent-strong", "--danger"];
const SURFACES = ["--bg", "--panel"];

test("themes.css defines all five themes", () => {
  assert.deepEqual(Object.keys(THEMES).sort(), NAMES.slice().sort());
});

for (const name of NAMES) {
  test(`contrast ${name}: text >= 4.5:1, focus ring >= 3:1 on --bg and --panel`, () => {
    const t = THEMES[name];
    const failures = [];
    for (const surface of SURFACES) {
      for (const v of TEXT_VARS) {
        const r = contrast(t[v], t[surface]);
        if (r < 4.5) failures.push(`${v} ${t[v]} on ${surface} ${t[surface]}: ${r.toFixed(2)}`);
      }
      const ring = contrast(t["--text"], t[surface]);
      if (ring < 3) failures.push(`focus ring on ${surface}: ${ring.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });

  test(`${name}: color-scheme matches the background, --glow defined`, () => {
    const t = THEMES[name];
    const expected = luminance(t["--bg"]) > 0.5 ? "light" : "dark";
    assert.equal(t["color-scheme"], expected);
    assert.ok(t["--glow"], "--glow missing");
  });
}

test("style.css :root fallback equals Lilac Carbon", () => {
  const root = /(^|\n):root\s*\{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(root, ":root block not found");
  const decls = parseDecls(root[2]);
  const lilac = THEMES["Lilac Carbon"];
  for (const k of Object.keys(lilac)) {
    assert.equal(decls[k], lilac[k], k);
  }
});

test("style.css: one visible :focus-visible ring, no outline:none, no fixed cyan", () => {
  assert.match(STYLE_CSS, /(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--text\)/);
  assert.doesNotMatch(STYLE_CSS, /outline:\s*none/);
  assert.doesNotMatch(STYLE_CSS, /rgba\(\s*34,\s*211,\s*238/);
  assert.doesNotMatch(STYLE_CSS, /rgba\(\s*125,\s*211,\s*252/);
});

test("colors.html swatch labels match themes.css", () => {
  const html = read("colors.html");
  const slug = (n) => n.toLowerCase().replace(/ /g, "-");
  for (const name of NAMES) {
    const start = html.indexOf(`data-scheme="${slug(name)}"`);
    assert.ok(start > 0, name);
    const end = html.indexOf("</section>", start);
    const part = html.slice(start, end);
    const pairs = {};
    for (const m of part.matchAll(
      /<div class="token">([a-z-]+)<\/div>\s*<div class="value">(#[0-9a-fA-F]{6})<\/div>/g,
    )) {
      pairs["--" + m[1]] = m[2].toLowerCase();
    }
    for (const k of ["--bg", "--panel", "--border", "--accent", "--accent-strong", ...TEXT_VARS]) {
      assert.equal(pairs[k], THEMES[name][k], `${name} ${k}`);
    }
  }
});

test("app pages: theme note no longer links colors.html (E6)", () => {
  for (const f of ["index.html", "wallet.html"]) {
    assert.doesNotMatch(read(f), /href="colors\.html"/, f);
  }
});

// --- theme.js in a vm ------------------------------------------------------

function loadThemeJs({ light = false, stored = null } = {}) {
  const store = new Map();
  if (stored) store.set("db-wallet:theme", stored);
  const attrs = {};
  const meta = { content: "#000000", setAttribute: (k, v) => (meta[k] = v) };
  const buttons = [];
  const container = {
    set innerHTML(v) {
      buttons.length = 0;
    },
    appendChild: (b) => buttons.push(b),
  };
  const mkEl = () => {
    const el = {
      dataset: {},
      _cls: new Set(),
      addEventListener(t, fn) {
        el._click = fn;
      },
    };
    el.classList = { toggle: (c, on) => (on ? el._cls.add(c) : el._cls.delete(c)) };
    return el;
  };
  const listeners = [];
  const ctx = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    matchMedia: (q) => ({
      matches: q.includes("light") ? light : !light,
      addEventListener: (t, fn) => listeners.push(fn),
    }),
    document: {
      documentElement: {
        setAttribute: (k, v) => (attrs[k] = v),
        getAttribute: (k) => attrs[k] || null,
      },
      querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
      querySelectorAll: (sel) => (sel === ".theme-btn" ? buttons : []),
      getElementById: (id) => (id === "theme-buttons" ? container : null),
      createElement: mkEl,
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("theme.js"), ctx, { filename: "theme.js" });
  return { ctx, store, attrs, meta, buttons, listeners };
}

test("theme.js THEME_BG equals --bg of every theme", () => {
  const { ctx } = loadThemeJs();
  for (const name of NAMES) {
    assert.equal(ctx.dbWalletTheme.THEME_BG[name], THEMES[name]["--bg"], name);
  }
});

test("no stored theme, dark OS: Lilac Carbon, not persisted, theme-color = --bg", () => {
  const { attrs, store, meta } = loadThemeJs({ light: false });
  assert.equal(attrs["data-theme"], "Lilac Carbon");
  assert.equal(store.has("db-wallet:theme"), false);
  assert.equal(meta.content, THEMES["Lilac Carbon"]["--bg"]);
});

test("no stored theme, light OS: Paper Mint, selector marks its button", () => {
  const { ctx, attrs, store, meta, buttons } = loadThemeJs({ light: true });
  assert.equal(attrs["data-theme"], "Paper Mint");
  assert.equal(meta.content, THEMES["Paper Mint"]["--bg"]);
  ctx.dbWalletTheme.initThemeSelector();
  const active = buttons.filter((b) => b._cls.has("active")).map((b) => b.dataset.theme);
  assert.deepEqual(active, ["Paper Mint"]);
  assert.equal(store.has("db-wallet:theme"), false, "the default is not stored");
});

test("stored theme wins; a click persists and updates theme-color", () => {
  const { ctx, attrs, store, meta, buttons } = loadThemeJs({ light: true, stored: "Teal Ember" });
  assert.equal(attrs["data-theme"], "Teal Ember");
  assert.equal(meta.content, THEMES["Teal Ember"]["--bg"]);
  ctx.dbWalletTheme.initThemeSelector();
  buttons.find((b) => b.dataset.theme === "Peach Cloud")._click();
  assert.equal(attrs["data-theme"], "Peach Cloud");
  assert.equal(store.get("db-wallet:theme"), "Peach Cloud");
  assert.equal(meta.content, THEMES["Peach Cloud"]["--bg"]);
});

test("OS switch is followed only while nothing is stored", () => {
  const env = loadThemeJs({ light: false });
  assert.equal(env.listeners.length, 1);
  env.ctx.matchMedia = (q) => ({ matches: q.includes("light") });
  env.listeners[0]();
  assert.equal(env.attrs["data-theme"], "Paper Mint");
  env.ctx.dbWalletTheme.applyTheme("Slate Sunrise");
  env.listeners[0]();
  assert.equal(env.attrs["data-theme"], "Slate Sunrise");
});
