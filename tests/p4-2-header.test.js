// P4.2: a compact header (title, small "Start"/"Info" links, who and which
// device), then a fixed row of three stats and the booking block right
// under it — no stat card hides at 0, so the buttons don't jump after the
// first booking. P4.7: the sync line only shows once there is a sync
// partner, and the device symbol is a labelled button whose choices explain
// themselves in visible text. P4.9: <header>/<main>, one h2 per block.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage } = require("./wallet-page");
const { REPO } = require("./harness");
const { findAll, find } = require("./fake-dom");

const HTML = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
const CSS = fs.readFileSync(path.join(REPO, "style.css"), "utf8");
const $ = (w, id) => w.document.getElementById(id);
const DAY = 86400000;

// The body's direct children, in order (tags with an id, or <hr>).
function bodyChildren(html) {
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const out = [];
  let depth = 0;
  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*?)(\/?)>/g;
  const VOID = new Set(["input", "br", "hr", "img", "meta", "link"]);
  let m;
  while ((m = re.exec(body))) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      depth--;
      continue;
    }
    if (depth === 0) {
      const id = /\bid="([^"]*)"/.exec(attrs);
      out.push(id ? `${tag}#${id[1]}` : tag);
    }
    if (!VOID.has(tag) && !selfClose) depth++;
  }
  return out;
}

test("wallet.html: <header> and <main>, the dialog and status line outside", () => {
  const top = bodyChildren(HTML).filter((t) => t !== "script");
  assert.deepEqual(top, [
    "header#wallet-header",
    "main#wallet-main",
    "dialog#confirm-dialog",
    "div#status-line",
  ]);
  const header = HTML.slice(HTML.indexOf("<header"), HTML.indexOf("</header>"));
  assert.match(header, /<h1>/);
  assert.match(header, /<a id="btn-home" href="index.html">Start<\/a>/);
  assert.match(header, /<a id="btn-info" href="https:\/\/github\.com\/bmmmm\/db-wallet" target="_blank" rel="noopener noreferrer">Info<\/a>/);
  assert.match(header, /id="device-symbol-selector"/);
  // The old full-width "Zur Startseite"/"Info" buttons are gone.
  assert.doesNotMatch(HTML, /Zur Startseite/);
});

test("main: stats, then booking, then the rest; one h2 per block", () => {
  const main = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
  const order = ["stat-panel", 'id="booking"', 'id="history-panel"', 'id="action-codes-panel"', 'id="sync-status-line"', 'class="wallet-export"', 'id="theme-panel"'];
  const pos = order.map((s) => main.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), JSON.stringify(pos));
  assert.deepEqual(pos.slice().sort((a, b) => a - b), pos, "block order");
  // The amount field and the three buttons are in the booking block.
  const booking = main.slice(main.indexOf('id="booking"'), main.indexOf('id="history-panel"'));
  for (const id of ["amount", "btn-drink", "btn-undo", "btn-pay", "pay-options", "credit-form"]) {
    assert.match(booking, new RegExp(`id="${id}"`), id);
  }
  const h2 = Array.from(main.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)).map((m) => m[1].trim());
  assert.deepEqual(h2, ["Stand", "Buchen", "Verlauf", "Action Codes", "Sync", "Export", "Theme auswählen"]);
  assert.match(CSS, /\.visually-hidden\s*\{[^}]*clip:/);
});

test("the three stats always show, also at 0 and after the first booking", async () => {
  const w = await bootWalletPage({ hash: "max" });
  const stats = findAll(w.document.body, (el) => el.classList.contains("stat"));
  assert.equal(stats.length, 3);
  assert.ok(stats.every((s) => !s.hidden), "nothing hidden at 0");
  $(w, "btn-drink").click();
  assert.equal($(w, "unpaid").textContent, "1");
  assert.equal($(w, "credit").textContent, "0");
  assert.ok(stats.every((s) => !s.hidden), "nothing hidden after a booking");
  const ui = fs.readFileSync(path.join(REPO, "wallet-ui.js"), "utf8");
  assert.doesNotMatch(ui, /toggleStatVisibility/);
  assert.match(CSS, /\.stat-panel\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
});

// --- P4.7 device symbol ----------------------------------------------------

const deviceRoot = (w) => $(w, "device-symbol-selector");
const toggleOf = (w) => find(deviceRoot(w), (el) => el.classList.contains("device-toggle"));
const optionsOf = (w) => find(deviceRoot(w), (el) => el.classList.contains("device-options"));
const symbolBtns = (w) => findAll(deviceRoot(w), (el) => el.classList.contains("device-symbol"));

function trackFocus(w) {
  const focused = [];
  const orig = w.document.createElement;
  w.document.createElement = (tag) => {
    const el = orig(tag);
    el.focus = () => focused.push(el);
    return el;
  };
  return focused;
}

test("device symbol: one labelled button, the choices open with their meaning", async () => {
  const w = await bootWalletPage({ hash: "max" });
  const root = deviceRoot(w);
  assert.equal(find(root, (el) => el.classList.contains("device-label")).textContent, "Gerät:");
  const t = toggleOf(w);
  assert.equal(t.textContent, "wählen");
  assert.equal(t.getAttribute("aria-label"), "Gerätesymbol wählen");
  assert.equal(t.getAttribute("aria-expanded"), "false");
  assert.equal(optionsOf(w), null, "no row of six unlabelled buttons");

  const focused = trackFocus(w);
  t.click();
  const opts = optionsOf(w);
  assert.ok(opts);
  assert.equal(toggleOf(w).getAttribute("aria-expanded"), "true");
  assert.equal(opts.getAttribute("role"), "group");
  const hint = find(opts, (el) => el.classList.contains("device-hint")).textContent;
  assert.match(hint, /kennzeichnet seine Buchungen in der Sync-Anzeige/);
  assert.match(hint, /Geräte-ID: devA/);
  assert.deepEqual(symbolBtns(w).map((b) => b.textContent), ["L", "M", "D", "K", "T", "*"]);
  assert.ok(symbolBtns(w).every((b) => b.getAttribute("aria-pressed") === "false"));
  assert.equal(focused[focused.length - 1].textContent, "L", "focus on the first choice");

  symbolBtns(w)[1].click(); // M
  assert.equal(optionsOf(w), null, "closes after the choice");
  assert.equal(toggleOf(w).textContent, "M");
  assert.equal(toggleOf(w).getAttribute("aria-label"), "Gerätesymbol M ändern");
  assert.equal(focused[focused.length - 1], toggleOf(w), "focus back on the button");
  assert.equal(w.dbWalletStorage.getLocalDeviceSymbol(w.dbWalletStorage.loadWallet("max")), "M");

  // Reopened: the current one is marked; Escape closes and returns focus.
  toggleOf(w).click();
  const pressed = symbolBtns(w).filter((b) => b.getAttribute("aria-pressed") === "true");
  assert.deepEqual(pressed.map((b) => b.textContent), ["M"]);
  assert.equal(focused[focused.length - 1].textContent, "M", "focus on the current choice");
  for (const fn of optionsOf(w).listeners.keydown) fn({ key: "Escape", preventDefault() {} });
  assert.equal(optionsOf(w), null);
  assert.equal(focused[focused.length - 1], toggleOf(w));
});

test("device UI: no inline styles, the meaning is not in a title tooltip", () => {
  const src = fs.readFileSync(path.join(REPO, "wallet-device-ui.js"), "utf8");
  assert.doesNotMatch(src, /\.style\./);
  assert.doesNotMatch(src, /\.title\s*=/);
  for (const cls of ["device-selector", "device-toggle", "device-options", "device-hint", "device-symbol"]) {
    assert.match(CSS, new RegExp(`\\.${cls}\\b`), cls);
  }
});

// --- P4.7 sync line --------------------------------------------------------

function seedPeer(ageDays) {
  return (e) => {
    const S = e.dbWalletStorage;
    const x = S.loadWallet("max");
    x.syncPeers = { devB: { label: "B", updatedAt: Date.now() - ageDays * DAY, commonEventCount: 0, peerEventCount: 0 } };
    S.saveWallet(x);
  };
}

const syncLine = (w) => $(w, "sync-status-line");
const syncText = (w) => find(syncLine(w), (el) => el.classList.contains("sync-text")).textContent;
const goExport = (w) => find(syncLine(w), (el) => el.classList.contains("sync-go-export"));

test("sync line: hidden on a fresh wallet and after a booking", async () => {
  const w = await bootWalletPage({ hash: "max" });
  assert.equal(syncLine(w).classList.contains("is-visible"), false);
  $(w, "btn-drink").click();
  assert.equal(syncLine(w).classList.contains("is-visible"), false);
  assert.match(CSS, /#sync-status-line\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(CSS, /#sync-status-line\.is-visible\s*\{\s*display:\s*block;?\s*\}/);
});

test("sync line: shown with a sync partner", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedPeer(1) });
  assert.equal(syncLine(w).classList.contains("is-visible"), true);
  assert.match(syncText(w), /Sync aktuell \(1 Tag – B\)/);
  assert.equal(goExport(w).hidden, true, "no jump button while fresh");
  assert.equal(syncLine(w).classList.contains("is-red"), false);
});

test("sync line: stale partner → red with a visible 'Zum Export' button", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedPeer(20) });
  assert.match(syncText(w), /Sync veraltet/);
  assert.equal(syncLine(w).classList.contains("is-red"), true);
  assert.equal(goExport(w).hidden, false);
  assert.equal($(w, "export-options").style.display, "");
  goExport(w).click();
  assert.equal($(w, "export-options").style.display, "inline-block", "export opened");
});

test("sync UI: classes instead of inline styles", () => {
  const src = fs.readFileSync(path.join(REPO, "wallet-sync-ui.js"), "utf8");
  assert.doesNotMatch(src, /\.style\./);
});

test("the no-wallet notice lands after the header, as a <body> child", () => {
  const hash = fs.readFileSync(path.join(REPO, "wallet-hash-actions.js"), "utf8");
  assert.match(hash, /anchors: \["#wallet-header", "\.top-row", "h1"\]/);
  const msgs = fs.readFileSync(path.join(REPO, "wallet-messages.js"), "utf8");
  assert.match(msgs, /\["#wallet-header", "\.top-row", "h1"\]/);
});
