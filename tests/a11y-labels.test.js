// Label in name (WCAG 2.5.3): a button's accessible name contains the text it
// shows, so "QR-Code (kurz) anzeigen" is not called "QR-Code anzeigen" by a
// screen reader (and a voice command for the visible words works). Buttons
// that open a block say whether it is open (aria-expanded).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { REPO } = require("./harness");
const { bootWalletPage } = require("./wallet-page");
const { find, button, card } = require("./fake-dom");

const HTML = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
const $ = (w, id) => w.document.getElementById(id);

// The words a button shows: no tags, no emoji or symbols.
const visibleWords = (inner) =>
  inner
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}\s:().,-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

test("wallet.html: every aria-label contains the button's visible words", () => {
  const buttons = Array.from(HTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g));
  assert.ok(buttons.length > 10);
  const bad = [];
  for (const [, attrs, inner] of buttons) {
    const label = /\baria-label="([^"]*)"/.exec(attrs);
    const shown = visibleWords(inner);
    if (!label || !shown) continue;
    if (!label[1].toLowerCase().includes(shown)) bad.push(`${label[1]} ⟵ ${shown}`);
  }
  assert.deepEqual(bad, []);
});

test("the QR export button no longer says '(kurz)': there is no other link export", () => {
  const tag = /<button id="btn-export-link-qr"[^>]*>([\s\S]*?)<\/button>/.exec(HTML);
  assert.equal(visibleWords(tag[1]), "qr-code anzeigen");
});

test("Export says whether its options are open", async () => {
  assert.match(HTML, /<button id="btn-export" aria-expanded="false" aria-controls="export-options">/);
  const w = await bootWalletPage({ hash: "max" });
  const btn = $(w, "btn-export");
  btn.click();
  assert.equal($(w, "export-options").style.display, "inline-block");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  // Opened from elsewhere (the sync line's "Zum Export").
  w.dbWalletExportUI.openSection();
  assert.equal(btn.getAttribute("aria-expanded"), "true");
});

test("code panel: 'Neuer Action Code' and 'Bearbeiten' say whether their form is open", async () => {
  const w = await bootWalletPage({
    hash: "max",
    seed: (e) => {
      const S = e.dbWalletStorage;
      const AC = e.dbWalletActionCodes;
      const x = S.loadWallet("max");
      x.actionCodes = [AC.buildActionCode({ type: "d", amount: 1, label: "Runde" }, 1000)];
      S.saveWallet(x);
    },
  });
  const body = $(w, "action-codes-body");
  assert.equal(button(body, "Neuer Action Code").getAttribute("aria-expanded"), "false");
  button(body, "Neuer Action Code").click();
  assert.equal(button(body, "Neuer Action Code").getAttribute("aria-expanded"), "true");
  assert.equal(button(card(body, "Runde"), "Bearbeiten").getAttribute("aria-expanded"), "false");
  button(card(body, "Runde"), "Bearbeiten").click();
  assert.equal(button(card(body, "Runde"), "Bearbeiten").getAttribute("aria-expanded"), "true");
  assert.equal(button(body, "Neuer Action Code").getAttribute("aria-expanded"), "false");
  assert.ok(find(body, (c) => c.classList.contains("action-code-form")));
});
