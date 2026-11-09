// P3.2: CSS basics for touch and readability. Static checks on style.css and
// index.html; how it looks is only verifiable in a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO } = require("./harness");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const CSS = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Body of the first `@media <query> {` block (brace-matched).
function mediaBlocks(css, query) {
  const out = [];
  let i = 0;
  while ((i = css.indexOf("@media " + query, i)) >= 0) {
    let j = css.indexOf("{", i) + 1;
    let depth = 1;
    const start = j;
    while (depth && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push(css.slice(start, j - 1));
    i = j;
  }
  return out;
}

function stripMedia(css) {
  let out = "";
  let i = 0;
  for (;;) {
    const k = css.indexOf("@media", i);
    if (k < 0) return out + css.slice(i);
    out += css.slice(i, k);
    let j = css.indexOf("{", k) + 1;
    let depth = 1;
    while (depth && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    i = j;
  }
}

test("mobile breakpoint: every button is at least 44px high", () => {
  const blocks = mediaBlocks(CSS, "(max-width: 640px)");
  assert.ok(blocks.length, "mobile breakpoint missing");
  const plainButtonRules = blocks
    .flatMap((b) => Array.from(b.matchAll(/([^{}]+)\{([^}]*)\}/g)))
    .filter((m) => m[1].split(",").some((sel) => sel.trim() === "button"));
  assert.ok(
    plainButtonRules.some((m) => /min-height:\s*44px/.test(m[2])),
    "button { min-height: 44px } missing in the mobile breakpoint",
  );
});

test("buttons and inputs inherit the page font", () => {
  assert.match(CSS, /button,\s*input[^{]*\{\s*font:\s*inherit;/);
});

test("hover effects only under (hover: hover)", () => {
  const outside = stripMedia(CSS);
  assert.doesNotMatch(outside, /button:hover/, "button:hover outside @media (hover: hover)");
  assert.doesNotMatch(outside, /\.global-action-card:hover/);
  const hover = mediaBlocks(CSS, "(hover: hover)").join("\n");
  assert.match(hover, /button:hover/);
});

test("prefers-reduced-motion block exists and stops transitions/transforms", () => {
  const rm = mediaBlocks(CSS, "(prefers-reduced-motion: reduce)").join("\n");
  assert.match(rm, /transition-duration/);
  assert.match(rm, /transform:\s*none/);
});

test("long ids wrap: #uid and .stat strong", () => {
  assert.match(CSS, /#uid\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(CSS, /\.stat strong\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test("QR canvases are scaled pixelated", () => {
  assert.match(CSS, /\.qr-box canvas\s*\{[^}]*image-rendering:\s*pixelated/);
  assert.match(CSS, /\.action-code-canvas\s*\{[^}]*image-rendering:\s*pixelated/);
});

test("index.html: visible label for the name field, no duplicate aria-label", () => {
  const html = read("index.html");
  assert.match(html, /<label for="username">Nutzer:in-Name<\/label>/);
  const input = /<input\s+id="username"[^>]*>/.exec(html);
  assert.ok(input);
  assert.doesNotMatch(input[0], /aria-label/);
  assert.doesNotMatch(html, /sr-only/, ".sr-only is not defined in style.css");
});
