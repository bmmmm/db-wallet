// P3.3: CSP without 'unsafe-inline' for style-src on the app pages. Without
// it the browser blocks style="…" attributes, <style> blocks, and from JS
// setAttribute("style", …), .style.cssText and HTML strings with style=
// (innerHTML/insertAdjacentHTML/outerHTML). Single el.style.x = … (CSSOM)
// assignments stay allowed. colors.html keeps its own CSP (not an app page).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const APP_PAGES = ["index.html", "wallet.html", "preview.html"];

function scriptsOf(html) {
  return Array.from(html.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)).map((m) => m[1]);
}

function csp(html) {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  return m ? m[1] : "";
}

for (const page of APP_PAGES) {
  test(`${page}: CSP without 'unsafe-inline', no inline styles`, () => {
    const html = read(page);
    const policy = csp(html);
    assert.ok(policy, "CSP meta missing");
    assert.doesNotMatch(policy, /'unsafe-inline'/);
    assert.match(policy, /style-src 'self'(;| )/);
    assert.match(policy, /script-src 'self'(;| )/);
    const attrs = Array.from(html.matchAll(/\sstyle\s*=\s*["']/g)).length;
    assert.equal(attrs, 0, "style= attributes");
    assert.doesNotMatch(html, /<style[\s>]/i);
    // No inline scripts or handlers either (script-src 'self').
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "inline <script>");
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, "inline event handler");
  });
}

// Every script an app page loads (including qrcodegen.js and self-check.js),
// plus the service worker and the self-check stub/loader if present.
const JS_FILES = Array.from(
  new Set(
    APP_PAGES.flatMap((p) => scriptsOf(read(p))).concat(
      ["qrcodegen.js", "self-check.js", "service-worker.js"].filter((f) =>
        fs.existsSync(path.join(REPO, f)),
      ),
    ),
  ),
).sort();

test("JS: no CSP-blocked style writes in any shipped script", () => {
  assert.ok(JS_FILES.includes("qrcodegen.js"));
  const hits = [];
  for (const f of JS_FILES) {
    const src = read(f);
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const where = `${f}:${i + 1}: ${line.trim()}`;
      if (/setAttribute\(\s*["'`]style["'`]/.test(line)) hits.push(where);
      if (/\.cssText\b/.test(line)) hits.push(where);
      if (/createElement\(\s*["'`]style["'`]/.test(line)) hits.push(where);
      if (/(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(line) && /style\s*=/.test(line)) {
        hits.push(where);
      }
      // HTML strings carrying a style attribute anywhere (template/literal).
      if (/["'`][^"'`]*<[a-z][^>]*\sstyle\s*=/i.test(line)) hits.push(where);
    });
  }
  assert.deepEqual(hits, []);
});

test("JS: every display toggle treats an unset inline display as hidden", () => {
  // The initial display:none now comes from style.css (#id rules), so the
  // element's inline style.display starts as "". A toggle that only checks
  // === "none" would hide an already hidden element on the first click.
  const offenders = [];
  for (const f of JS_FILES) {
    const src = read(f);
    for (const m of src.matchAll(/([\w.]+)\.style\.display\s*===\s*"none"/g)) {
      const tail = src.slice(m.index, m.index + 200);
      if (!new RegExp(m[1].replace(/\./g, "\\.") + '\\.style\\.display\\s*===\\s*""').test(tail)) {
        offenders.push(`${f}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("style.css hides what the pages used to hide inline", () => {
  const css = read("style.css");
  for (const id of [
    "btn-migrate",
    "pay-options",
    "export-options",
    "export-url",
    "qr-box",
    "file-import",
  ]) {
    const re = new RegExp(`#${id}[\\s,][^{]*\\{[^}]*display:\\s*none`);
    const listed = new RegExp(`(^|\\n)[^{}]*#${id}\\b[^{}]*\\{[^}]*display:\\s*none`);
    assert.ok(re.test(css) || listed.test(css), `#${id} not hidden by style.css`);
  }
});
