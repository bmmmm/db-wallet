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

// One copy of the theme values: bare :root (no data-theme yet) gets Lilac
// Carbon from its rule in themes.css, style.css defines no theme token.
test("Lilac Carbon is the :root fallback, defined once in themes.css", () => {
  const css = THEMES_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = Array.from(css.matchAll(/([^{}]+)\{/g), (m) => m[1].split(",").map((x) => x.trim()));
  const lilac = blocks.find((sels) => sels.includes(':root[data-theme="Lilac Carbon"]'));
  assert.ok(lilac && lilac.includes(":root"), "the Lilac Carbon rule must also select bare :root");
  assert.equal(blocks.filter((sels) => sels.includes(":root")).length, 1);
  const root = /(^|\n):root\s*\{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(root, ":root block not found");
  const tokens = Object.keys(parseDecls(root[2])).filter((k) => k in THEMES["Lilac Carbon"]);
  assert.deepEqual(tokens, [], "theme tokens in style.css :root");
  for (const page of ["index.html", "wallet.html", "preview.html"]) {
    const html = read(page);
    const at = (f) => html.indexOf(`<link rel="stylesheet" href="${f}" />`);
    assert.ok(at("style.css") >= 0 && at("themes.css") > at("style.css"), page);
  }
});

test("style.css: one visible :focus-visible ring, no outline:none, no fixed cyan", () => {
  assert.match(STYLE_CSS, /(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--text\)/);
  assert.doesNotMatch(STYLE_CSS, /outline:\s*none/);
  assert.doesNotMatch(STYLE_CSS, /rgba\(\s*34,\s*211,\s*238/);
  assert.doesNotMatch(STYLE_CSS, /rgba\(\s*125,\s*211,\s*252/);
});

// Top-level and @media-nested rules as {selectors, body}; comments dropped.
function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return Array.from(src.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
    selectors: m[1].replace(/@media[^{]*$/, "").split(",").map((x) => x.trim().replace(/\s+/g, " ")),
    body: m[2],
  }));
}

// The three collapsible blocks clip their content (overflow: hidden, for the
// rounded corners), which also clips a focus ring drawn outside the summary
// (:focus-visible, outline-offset 2px). Their summaries draw it inside.
test("style.css: the focus ring of a clipped <details> summary is drawn inside", () => {
  const all = cssRules(STYLE_CSS);
  const panels = ["action-codes", "wallet-actions", "theme"];
  for (const p of panels) {
    const clip = all.find((r) => r.selectors.includes(`.${p}-panel`) && /overflow:\s*hidden/.test(r.body));
    assert.ok(clip, `.${p}-panel no longer clips: drop this test`);
    const ring = all.find((r) => r.selectors.includes(`.${p}-summary:focus-visible`));
    assert.ok(ring, `.${p}-summary:focus-visible rule missing`);
    const off = /outline-offset:\s*(-?\d+)px/.exec(ring.body);
    assert.ok(off && Number(off[1]) <= -2, `.${p}-summary: outline-offset must be <= -2px (ring width)`);
  }
});

// The page background follows the theme: the two radial highlights are
// mixed from --accent (no fixed blue from the old theme on every theme).
// color-mix() sits only in background-image, so a browser without it drops
// the highlights, not the --bg colour.
test("style.css: the page background is tinted by the theme, never a fixed colour", () => {
  const root = cssRules(STYLE_CSS).find((r) => r.selectors.length === 1 && r.selectors[0] === ":root");
  assert.ok(root, ":root rule missing");
  assert.match(root.body, /(^|;)\s*background-color:\s*var\(--bg\)\s*;/);
  assert.doesNotMatch(root.body, /(^|;)\s*background\s*:/, "no background shorthand on :root");
  const image = /(^|;)\s*background-image:([^;]*);/.exec(root.body);
  assert.ok(image, "background-image missing");
  assert.doesNotMatch(image[2], /rgba?\(|#[0-9a-f]{3,8}\b/i, "fixed colour in the background");
  assert.match(image[2], /radial-gradient/);
  assert.match(image[2], /color-mix\(in srgb, var\(--accent\)/);
  for (const r of cssRules(STYLE_CSS)) {
    for (const d of r.body.split(";")) {
      if (d.includes("color-mix(")) assert.match(d, /^\s*background-image\s*:/, r.selectors.join(", "));
    }
  }
});

// --- theme.js in a vm ------------------------------------------------------

function loadThemeJs({ light = false, stored = null, label = null } = {}) {
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
      _attrs: {},
      setAttribute(k, v) {
        el._attrs[k] = String(v);
      },
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
      getElementById: (id) =>
        id === "theme-buttons" ? container : id === "current-theme-name" ? label : null,
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
  // P4.9: the state is announced too, not only coloured.
  const pressed = buttons.filter((b) => b._attrs["aria-pressed"] === "true").map((b) => b.dataset.theme);
  assert.deepEqual(pressed, ["Paper Mint"]);
  assert.ok(buttons.every((b) => b._attrs["aria-pressed"] && b.type === "button"));
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

// wallet.html shows the theme's name in the panel summary; it must follow
// every change, the OS switch without a stored theme too (theme.js applies
// it, wallet-ui.js only knew about clicks).
test("#current-theme-name follows the selector and the OS switch", () => {
  const label = { textContent: "Lilac Carbon" };
  const env = loadThemeJs({ light: false, label });
  env.ctx.dbWalletTheme.initThemeSelector();
  assert.equal(label.textContent, "Lilac Carbon");
  env.ctx.matchMedia = (q) => ({ matches: q.includes("light") });
  env.listeners[0]();
  assert.equal(env.attrs["data-theme"], "Paper Mint");
  assert.equal(label.textContent, "Paper Mint");
  env.buttons.find((b) => b.dataset.theme === "Teal Ember")._click();
  assert.equal(label.textContent, "Teal Ember");
  env.ctx.dbWalletTheme.applyTheme("Nord Glow"); // legacy alias (import)
  assert.equal(label.textContent, "Lilac Carbon");
});
