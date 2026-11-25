// P4.5: the start page lists the wallets before "open or create"; a name
// that exists opens that wallet (it used to create "peter-2" silently);
// umlauts are spelled out ("Jörg" → "joerg", was "jrg"); "Löschen" sits
// apart in --danger and offers a JSON backup in the confirm dialog, which
// replaces the native confirm()s of index-ui.js. P4.8: "Link einfügen"
// hands the hash of a pasted link to wallet.html's router. P4.9: header /
// main, and the import choice is a native <dialog> that gives the focus back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, plain, settle, waitFor, REPO } = require("./harness");
const { makePageDocument, makeFakeDocument, FakeElement, find, findAll } = require("./fake-dom");

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const INDEX_HTML = read("index.html");
const CSS = read("style.css");
const INDEX_SKIP = new Set(["theme.js", "import-preview.js", "sw-register.js"]);
const INDEX_FILES = Array.from(INDEX_HTML.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
  .map((m) => m[1])
  .filter((f) => !INDEX_SKIP.has(f));
const BASE = "https://example.invalid/";

// Seeds wallets (name → number of drinks) on a fresh storage.
function seedStorage(wallets) {
  const storage = makeStorage();
  const e = makeEnv({ storage, deviceKey: "devA" });
  const S = e.dbWalletStorage;
  for (const [name, n] of Object.entries(wallets)) {
    const x = S.loadWallet(name);
    if (n > 0) S.appendEvents(x, [S.newEvent(x, "d", n)]);
    else S.saveWallet(x);
  }
  return storage;
}

async function bootIndex(opts = {}) {
  const storage = opts.storage || makeStorage();
  const document = makePageDocument(INDEX_HTML);
  const w = makeEnv({
    storage,
    deviceKey: "devA",
    document,
    files: INDEX_FILES,
    url: BASE + "index.html" + (opts.hash ? "#" + opts.hash : ""),
  });
  if (opts.beforeBoot) opts.beforeBoot(w);
  const booted = Promise.all(document._fire("DOMContentLoaded"));
  if (opts.noWait) {
    w._booted = booted;
    await settle();
    return w;
  }
  await booted;
  await settle();
  return w;
}

// Every URL the page went to after its start (the fake history treats a
// second wallet.html#… as a hash change, so pageLoads holds only the first).
const visited = (w) => w._nav.entries.slice(1);

const $ = (w, id) => w.document.getElementById(id);
const cards = (w) => findAll($(w, "existing-users"), (el) => el.classList.contains("wallet-card"));
const cardOf = (w, name) =>
  cards(w).find((c) => find(c, (el) => el.classList.contains("wallet-card-name")).textContent === name);
const btnIn = (card, cls) => find(card, (el) => el.classList.contains(cls));

// The page's #confirm-dialog with the two HTMLDialogElement methods.
function fakeDialog(w) {
  const dlg = $(w, "confirm-dialog");
  const shown = [];
  dlg.showModal = () => {
    dlg.open = true;
    shown.push($(w, "confirm-text").textContent);
  };
  dlg.close = () => {
    dlg.open = false;
    dlg.dispatch("close");
  };
  return { dlg, shown };
}

function input(w, id, value) {
  const el = $(w, id);
  el.value = value;
  el.dispatch("input");
}

// --- user ids ----------------------------------------------------------------

test("normalizeUserId spells out umlauts and drops accents", () => {
  const { normalizeUserId } = makeEnv().dbWalletHelpers;
  assert.equal(normalizeUserId("Jörg"), "joerg");
  assert.equal(normalizeUserId("Müller Straße"), "mueller-strasse");
  assert.equal(normalizeUserId("ÄÖÜ"), "aeoeue");
  assert.equal(normalizeUserId("José"), "jose");
  // A decomposed "ö" (o + combining diaeresis), as some keyboards send it.
  assert.equal(normalizeUserId("Jo" + String.fromCharCode(0x308) + "rg"), "joerg");
  assert.equal(normalizeUserId("küche 2"), "kueche-2");
  assert.equal(normalizeUserId("!!!"), "");
  // An imported user id goes through the same rule.
  const w = makeEnv({ deviceKey: "devA" });
  const built = w.dbWalletImportV2.buildImportedWallet({ userId: "Jörg", events: [] });
  assert.equal(built.userId, "joerg");
});

// --- page structure ------------------------------------------------------------

test("index.html: header, then the wallet list before 'open or create'", () => {
  const body = INDEX_HTML.slice(INDEX_HTML.indexOf("<body>"));
  assert.match(body, /<header id="index-header"/);
  assert.match(body, /<a id="btn-info" href="https:\/\/github\.com\/bmmmm\/db-wallet" target="_blank" rel="noopener noreferrer">Info<\/a>/);
  const order = ['<main id="index-main">', 'id="existing-users-section"', 'id="new-user-section"', 'id="paste-link-section"', 'id="import-title"', 'id="theme-section"', "</main>", 'id="confirm-dialog"', 'id="status-line"'];
  const pos = order.map((s) => body.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), JSON.stringify(pos));
  assert.deepEqual(pos.slice().sort((a, b) => a - b), pos, "block order");
  assert.match(body, /<ul id="existing-users" class="wallet-list"><\/ul>/);
  assert.match(body, /<button id="confirm-extra" type="button" hidden><\/button>/);
  assert.match(body, /<button id="btn-nuke-all" class="btn-danger" type="button">/);
  const h2 = Array.from(body.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)).map((m) => m[1].trim());
  assert.deepEqual(h2, ["Deine Wallets", "Wallet öffnen oder anlegen", "Link einfügen", "Import &amp; Rohdaten", "Theme auswählen"]);
});

test("index-ui.js: no native confirm, no inline styles; delete in --danger", () => {
  const src = read("index-ui.js");
  assert.doesNotMatch(src, /window\.confirm|\bconfirm\(/);
  assert.doesNotMatch(src, /\.style\./);
  assert.doesNotMatch(src, /makeUniqueUserId/, "an existing name is opened, not renamed");
  assert.match(CSS, /\.btn-danger\s*\{[^}]*color:\s*var\(--danger\)/);
  assert.match(CSS, /\.wallet-card-actions\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(CSS, /\.confirm-buttons button\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

// --- the list ------------------------------------------------------------------

test("no wallets: the list section stays hidden", async () => {
  const w = await bootIndex();
  assert.equal($(w, "existing-users-section").hidden, true);
  assert.equal(cards(w).length, 0);
});

test("the list shows every wallet with its numbers, 'Öffnen' and a separate 'Löschen'", async () => {
  const w = await bootIndex({ storage: seedStorage({ peter: 3, anna: 0 }) });
  assert.equal($(w, "existing-users-section").hidden, false);
  assert.equal(cards(w).length, 2);
  const peter = cardOf(w, "peter");
  assert.equal(peter.tagName, "LI");
  const summary = find(peter, (el) => el.classList.contains("wallet-card-summary")).textContent;
  assert.equal(summary, "Getrunken: 3 · Offen: 3 · Guthaben: 0");
  const open = btnIn(peter, "wallet-open");
  const del = btnIn(peter, "wallet-delete");
  assert.equal(open.textContent, "Öffnen");
  assert.equal(open.getAttribute("aria-label"), "Wallet „peter“ öffnen");
  assert.equal(del.textContent, "Löschen");
  assert.ok(del.classList.contains("btn-danger"));
  assert.equal(del.getAttribute("aria-label"), "Wallet „peter“ löschen");
  open.click();
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#peter"]);
});

// --- open or create ----------------------------------------------------------------

test("an existing name opens that wallet instead of creating 'peter-2'", async () => {
  const w = await bootIndex({ storage: seedStorage({ peter: 1 }) });
  input(w, "username", "  Peter ");
  assert.equal($(w, "username-hint").textContent, "Öffnet das vorhandene Wallet „peter“.");
  $(w, "btn-start").click();
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#peter"]);
});

test("a new name with umlauts: the hint names the id, Enter creates it", async () => {
  const w = await bootIndex();
  assert.equal($(w, "username-hint").textContent, "", "no hint while empty");
  input(w, "username", "Jörg");
  assert.equal($(w, "username-hint").textContent, "Legt das neue Wallet „joerg“ an.");
  for (const fn of $(w, "username").listeners.keydown) fn({ key: "Enter" });
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#joerg"]);
});

test("an empty or unusable name gets a random id", async () => {
  const w = await bootIndex();
  input(w, "username", "!!!");
  assert.match($(w, "username-hint").textContent, /zufälligem Namen/);
  $(w, "btn-start").click();
  input(w, "username", "");
  $(w, "btn-start").click();
  const urls = visited(w);
  assert.equal(urls.length, 2);
  for (const url of urls) assert.match(url, /wallet\.html#user-[a-z0-9]+$/);
  assert.notEqual(urls[0], urls[1]);
});

// --- delete with backup ------------------------------------------------------------

test("Löschen asks in the dialog (danger), offers the backup, then deletes", async () => {
  const storage = seedStorage({ peter: 3, anna: 1 });
  const w = await bootIndex({ storage });
  const { dlg, shown } = fakeDialog(w);
  const blobs = [];
  w.dbWalletHelpers.downloadBlob = (blob, name) => {
    blobs.push({ blob, name });
    return true;
  };
  const focused = [];
  btnIn(cardOf(w, "anna"), "wallet-open").focus = () => focused.push("anna-open");
  btnIn(cardOf(w, "peter"), "wallet-delete").click();

  assert.equal(shown.length, 1);
  assert.match(shown[0], /Wallet „peter“ auf diesem Gerät löschen\?/);
  assert.match(shown[0], /Der eine Eintrag geht hier verloren/);
  assert.ok(dlg.classList.contains("is-danger"));
  assert.equal($(w, "confirm-ok").textContent, "Löschen");
  const extra = $(w, "confirm-extra");
  assert.equal(extra.hidden, false);
  assert.equal(extra.textContent, "Vorher Backup herunterladen 📄");

  // The backup: the same JSON as wallet.html's export, and it imports back.
  extra.click();
  assert.equal(blobs.length, 1);
  assert.match(blobs[0].name, /^db-wallet-peter-\d{4}-\d{2}-\d{2}-backup\.json$/);
  assert.equal(extra.textContent, "Backup heruntergeladen ✓");
  assert.equal(dlg.open, true, "the question stays open");
  const json = JSON.parse(await blobs[0].blob.text());
  const stored = JSON.parse(storage.getItem("db-wallet:peter"));
  assert.equal(json.userId, "peter");
  assert.equal(json.walletId, stored.walletId);
  assert.deepEqual(json.events, stored.events);
  const other = makeEnv({ deviceKey: "devB" });
  const built = other.dbWalletImportV2.buildImportedWallet(json);
  assert.equal(built.userId, "peter");
  assert.equal(built.wallet.events.length, 1);

  // Re-render the list behind the dialog (the open user is "peter").
  btnIn(cardOf(w, "peter"), "wallet-open").focus = () => {};
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(storage.getItem("db-wallet:peter"), null);
  assert.ok(storage.getItem("db-wallet:anna"));
  assert.deepEqual(cards(w).map((c) => find(c, (el) => el.classList.contains("wallet-card-name")).textContent), ["anna"]);
  assert.equal($(w, "status-text").textContent, "Wallet „peter“ gelöscht.");
  assert.equal(extra.hidden, true, "the extra button belongs to this question only");
});

test("Löschen: the question counts the entries the history shows", async () => {
  const storage = makeStorage();
  const e = makeEnv({ storage, deviceKey: "devA" });
  const S = e.dbWalletStorage;
  const x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 1), S.newEvent(x, "d", 2), S.newEvent(x, "c", 5)]);
  S.undoLastEvent(x); // the credit is gone: 4 events, 2 entries
  S.saveWallet(S.loadWallet("leer"));
  const w = await bootIndex({ storage });
  const { shown } = fakeDialog(w);
  btnIn(cardOf(w, "max"), "wallet-delete").click();
  assert.match(shown[0], /Alle 2 Einträge gehen hier verloren/);
  $(w, "confirm-cancel").click();
  await settle();
  btnIn(cardOf(w, "leer"), "wallet-delete").click();
  assert.match(shown[1], /Es enthält noch keine Einträge\. Ein Backup/);
  $(w, "confirm-cancel").click();
  await settle();
});

test("Löschen, then Abbrechen: nothing is deleted", async () => {
  const storage = seedStorage({ peter: 3 });
  const w = await bootIndex({ storage });
  fakeDialog(w);
  btnIn(cardOf(w, "peter"), "wallet-delete").click();
  $(w, "confirm-cancel").click();
  await settle();
  assert.ok(storage.getItem("db-wallet:peter"));
  assert.equal(cards(w).length, 1);
});

test("after the last wallet is deleted the focus goes to the name field", async () => {
  const w = await bootIndex({ storage: seedStorage({ peter: 1 }) });
  fakeDialog(w);
  let focused = false;
  $(w, "username").focus = () => {
    focused = true;
  };
  btnIn(cardOf(w, "peter"), "wallet-delete").click();
  $(w, "confirm-ok").click();
  await settle();
  assert.equal($(w, "existing-users-section").hidden, true);
  assert.equal(focused, true);
});

test("'Alle löschen': one danger question with the names and backups for each", async () => {
  const storage = seedStorage({ peter: 1, anna: 2 });
  const w = await bootIndex({ storage });
  const { shown } = fakeDialog(w);
  const blobs = [];
  w.dbWalletHelpers.downloadBlob = (blob, name) => {
    blobs.push(name);
    return true;
  };
  $(w, "btn-nuke-all").click();
  assert.equal(shown.length, 1);
  assert.match(shown[0], /Alle 2 lokalen Nutzer:innen vollständig löschen\?/);
  assert.match(shown[0], /anna, peter/);
  assert.match(shown[0], /nicht rückgängig/);
  assert.equal($(w, "confirm-ok").textContent, "Alle 2 löschen");
  assert.equal($(w, "confirm-extra").textContent, "Vorher 2 Backups herunterladen 📄");
  $(w, "confirm-extra").click();
  assert.equal(blobs.length, 2);
  assert.equal($(w, "confirm-extra").textContent, "2 Backups heruntergeladen ✓");
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(storage.getItem("db-wallet:peter"), null);
  assert.equal(storage.getItem("db-wallet:anna"), null);
  assert.equal($(w, "existing-users-section").hidden, true);
});

// The origin (bmmmm.github.io) is shared by every Pages project of the
// account: deleting a wallet must not remove another app's key that happens
// to be named like the wallet (db-wallet never writes bare-name keys).
test("Löschen and 'Alle löschen' leave other apps' keys alone", async () => {
  const storage = seedStorage({ peter: 1, settings: 2 });
  const foreign = { peter: "other app", settings: "{\"dark\":true}", "other-app:state": "1" };
  for (const [k, v] of Object.entries(foreign)) storage.setItem(k, v);
  storage.setItem("db-wallet.share-hint-seen", "1");
  const before = new Set(Array.from({ length: storage.length }, (_, i) => storage.key(i)));
  const w = await bootIndex({ storage });
  fakeDialog(w);

  btnIn(cardOf(w, "settings"), "wallet-delete").click();
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(storage.getItem("db-wallet:settings"), null);
  assert.equal(storage.getItem("settings"), foreign.settings);

  $(w, "btn-nuke-all").click();
  $(w, "confirm-ok").click();
  await settle();
  assert.equal(storage.getItem("db-wallet:peter"), null);
  for (const [k, v] of Object.entries(foreign)) assert.equal(storage.getItem(k), v, k);
  const after = new Set(Array.from({ length: storage.length }, (_, i) => storage.key(i)));
  const removed = [...before].filter((k) => !after.has(k)).sort();
  assert.deepEqual(removed, ["db-wallet:peter", "db-wallet:registry", "db-wallet:settings"]);
  assert.ok(after.has("db-wallet:device"), "the device identity stays");
});

// --- P4.8 link einfügen ------------------------------------------------------------

test("hashFromPastedLink: only the part after '#' counts", async () => {
  const w = await bootIndex();
  const { hashFromPastedLink } = w.dbWalletIndexUI;
  assert.equal(hashFromPastedLink("https://other.example/db-wallet/wallet.html#i2:AbC_d-1"), "i2:AbC_d-1");
  assert.equal(hashFromPastedLink("  #ac:xyz \n"), "ac:xyz");
  assert.equal(hashFromPastedLink("i2:AbC\nd-1"), "i2:AbCd-1", "a wrapped link joins up");
  assert.equal(hashFromPastedLink("https://x.example/wallet.html%23acg:q"), "acg:q");
  assert.equal(hashFromPastedLink(""), "");
});

test("Link einfügen: an import link opens wallet.html with that hash", async () => {
  const w = await bootIndex();
  input(w, "paste-link", "https://elsewhere.example/app/wallet.html#i2:AAAA");
  $(w, "paste-link-form").dispatch("submit");
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#i2:AAAA"]);
});

test("Link einfügen: action codes (local and global) go to wallet.html too", async () => {
  const w = await bootIndex();
  for (const h of ["ac:abc", "acg:def"]) {
    input(w, "paste-link", "https://x.example/index.html#" + h);
    $(w, "paste-link-form").dispatch("submit");
  }
  assert.deepEqual(visited(w), [BASE + "wallet.html#ac:abc", BASE + "wallet.html#acg:def"]);
});

test("Link einfügen: a known wallet name opens it, an unknown one explains", async () => {
  const w = await bootIndex({ storage: seedStorage({ peter: 1 }) });
  input(w, "paste-link", "https://x.example/wallet.html#peter");
  $(w, "paste-link-form").dispatch("submit");
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#peter"]);

  input(w, "paste-link", "https://x.example/wallet.html#max");
  $(w, "paste-link-form").dispatch("submit");
  assert.equal(w._nav.pageLoads.length, 1, "no empty wallet 'max' created");
  assert.match($(w, "status-text").textContent, /nennt nur den Namen „max“/);
  assert.ok($(w, "status-line").classList.contains("is-error"));
  assert.equal($(w, "paste-link").getAttribute("aria-invalid"), "true");
  input(w, "paste-link", "x");
  assert.equal($(w, "paste-link").getAttribute("aria-invalid"), null, "typing clears the mark");
});

test("an error notice scrolls the focused field out from behind the status line", async () => {
  const w = await bootIndex();
  const scrolled = [];
  w.scrollBy = (x, y) => scrolled.push(y);
  w.innerHeight = 740;
  const field = $(w, "paste-link");
  field.focus = () => {
    w.document.activeElement = field;
  };
  // 360×740: the field sits at 709–753, the two-line notice starts at 584.
  field.getBoundingClientRect = () => ({ top: 709, bottom: 753 });
  $(w, "status-line").getBoundingClientRect = () => ({ top: 584, bottom: 728 });
  input(w, "paste-link", "https://example.com/x");
  $(w, "paste-link-form").dispatch("submit");
  assert.deepEqual(scrolled, [753 - 584 + 12]);
  // A field that is already clear of the line stays where it is.
  field.getBoundingClientRect = () => ({ top: 300, bottom: 344 });
  $(w, "paste-link-form").dispatch("submit");
  assert.equal(scrolled.length, 1);
});

test("Link einfügen: no link or something else is refused with a reason", async () => {
  const w = await bootIndex();
  $(w, "paste-link-form").dispatch("submit");
  assert.match($(w, "status-text").textContent, /zuerst einen Link einfügen/);
  input(w, "paste-link", "https://example.com/some/page");
  $(w, "paste-link-form").dispatch("submit");
  assert.match($(w, "status-text").textContent, /Kein db-wallet-Link erkannt/);
  assert.deepEqual(w._nav.pageLoads, []);
});

// --- the opened #i2: link asks in the dialog ------------------------------------------------

test("index.html#i2:…: the 'open in wallet.html?' question uses the dialog", async () => {
  let shown;
  const w = await bootIndex({
    hash: "i2:AAAA",
    noWait: true,
    beforeBoot: (w) => {
      shown = fakeDialog(w).shown;
    },
  });
  // The question waits for the link's wallet id; an i2: link is gunzipped
  // first, on real time. Clicking before it is shown answers nothing, and the
  // boot would wait forever.
  await waitFor(() => shown.length, "the import question");
  await settle();
  assert.equal(shown.length, 1);
  assert.match(shown[0], /Import Link erkannt/);
  assert.equal($(w, "confirm-ok").textContent, "Öffnen");
  assert.equal($(w, "existing-users-section").hidden, true, "the page rendered behind the question");
  $(w, "confirm-ok").click();
  await w._booted;
  assert.deepEqual(w._nav.pageLoads, [BASE + "wallet.html#i2:AAAA"]);
});

test("index.html#…: the question names the local wallet a link belongs to", async () => {
  const storage = seedStorage({ max: 2 });
  const src = makeEnv({ storage });
  const H = src.dbWalletHelpers;
  const max = src.dbWalletStorage.loadWallet("max");
  const bytes = src.dbWalletImportV2.encodeImportV2Bytes(max, "");
  const json = JSON.stringify({ walletId: max.walletId, userId: "max", events: [] });
  const ac = JSON.stringify({ v: 1, walletId: max.walletId, codeId: "c1", key: "k" });
  const links = [
    ["i2u:" + H.base64UrlEncodeBytes(bytes), /^Import Link erkannt\.\n\nLokales Profil: "max"/],
    ["i2:" + H.base64UrlEncodeBytes(await H.gzipCompress(bytes)), /Lokales Profil: "max"/],
    ["import:" + H.base64UrlEncode(json), /Lokales Profil: "max"/],
    ["ac:" + H.base64UrlEncode(ac), /^Action Code Link erkannt\.\n\nLokales Profil: "max"/],
    ["ac:" + H.base64UrlEncode(ac.replace(max.walletId, "w-other")), /lokal nicht bekannt/],
    // Cut off: no wallet id, the plain question (wallet.html reports the error).
    ["i2u:" + H.base64UrlEncodeBytes(bytes.subarray(0, 12)), /^Import Link erkannt\.\n\nIn wallet\.html öffnen\?$/],
  ];
  for (const [hash, expected] of links) {
    let shown;
    const w = await bootIndex({
      storage,
      hash,
      noWait: true,
      beforeBoot: (w) => {
        shown = fakeDialog(w).shown;
      },
    });
    await waitFor(() => shown.length, "the question for " + hash.slice(0, 8));
    await settle();
    assert.equal(shown.length, 1, hash.slice(0, 8));
    assert.match(shown[0], expected, hash.slice(0, 8));
    $(w, "confirm-cancel").click();
    await w._booted;
  }
});

test("index.html#i2:…: 'Abbrechen' drops the link from the address bar", async () => {
  let shown;
  const w = await bootIndex({
    hash: "i2:AAAA",
    noWait: true,
    beforeBoot: (w) => {
      shown = fakeDialog(w).shown;
    },
  });
  await waitFor(() => shown.length, "the import question");
  $(w, "confirm-cancel").click();
  await w._booted;
  assert.deepEqual(w._nav.pageLoads, []);
  assert.equal(w.location.hash, "");
});

// --- P4.9 import choice as a native <dialog> ---------------------------------------------

function importPreviewEnv() {
  const document = makeFakeDocument();
  const made = [];
  document.createElement = (tag) => {
    const el = new FakeElement(tag);
    if (el.tagName === "DIALOG") {
      el.showModal = () => {
        el.open = true;
        el._modal = true;
      };
      el.close = () => {
        el.open = false;
        el.dispatch("close");
      };
      made.push(el);
    }
    return el;
  };
  const opener = new FakeElement("button");
  let refocused = 0;
  opener.focus = () => refocused++;
  document.activeElement = opener;
  const w = makeEnv({
    document,
    files: ["wallet-helpers.js", "wallet-summary.js", "import-preview.js"],
  });
  return { w, document, made, refocused: () => refocused };
}

const choiceButtons = (dlg) => findAll(dlg, (el) => el.tagName === "BUTTON");

test("import choice: a modal <dialog> with a heading; a choice resolves and returns the focus", async () => {
  const { w, document, made, refocused } = importPreviewEnv();
  const p = w.dbWalletImportPreview.chooseImportMode({ header: "Import für \"max\"" });
  assert.equal(made.length, 1);
  const dlg = made[0];
  assert.equal(dlg._modal, true, "showModal");
  assert.ok(document.body.children.includes(dlg));
  assert.equal(dlg.getAttribute("aria-labelledby"), "import-choice-title");
  const title = find(dlg, (el) => el.id === "import-choice-title");
  assert.equal(title.tagName, "H2");
  assert.equal(title.textContent, "Import für \"max\"");
  const btns = choiceButtons(dlg);
  assert.deepEqual(btns.map((b) => b.type), ["button", "button", "button"]);
  btns[0].click();
  assert.equal(await p, "persist");
  assert.equal(dlg.open, false);
  assert.ok(!document.body.children.includes(dlg), "removed");
  assert.equal(refocused(), 1, "focus back on the opener");
});

test("import choice: Escape ('cancel') and a backdrop click resolve null", async () => {
  const { w, made } = importPreviewEnv();
  const api = w.dbWalletImportPreview;
  const p1 = api.chooseImportMode({});
  let prevented = false;
  for (const fn of made[0].listeners.cancel) fn({ preventDefault: () => (prevented = true) });
  assert.equal(await p1, null);
  assert.equal(prevented, true);

  const p2 = api.chooseImportMode({});
  made[1].dispatch("click"); // target = the dialog itself = the backdrop
  assert.equal(await p2, null);

  const p3 = api.chooseImportMode({});
  choiceButtons(made[2])[1].click();
  assert.equal(await p3, "preview");
});

test("import choice: no inline styles left in import-preview.js", () => {
  const src = read("import-preview.js");
  assert.doesNotMatch(src, /\.style\./);
  assert.doesNotMatch(src, /import-choice-overlay/);
  assert.match(CSS, /\.import-choice-dialog::backdrop/);
  // width: 100% plus padding must not overflow the dialog (360 px phones).
  assert.match(CSS, /\.import-choice-modal\s*\{[^}]*box-sizing:\s*border-box/);
  assert.match(CSS, /\.import-choice-cancel\s*\{[^}]*box-sizing:\s*border-box;[^}]*margin:\s*0/);
});

// preview.html: the cached payload renders read-only; its theme is shown but
// never stored, and a name outside the theme whitelist is ignored.
function previewPage(payload) {
  const document = makePageDocument(read("preview.html"));
  document.body.dataset.page = "preview";
  const w = makeEnv({
    document,
    url: BASE + "preview.html#tok",
    files: ["theme.js", "wallet-helpers.js", "wallet-summary.js", "import-preview.js"],
  });
  w.sessionStorage.setItem("db-wallet:import-cache:tok", JSON.stringify(payload));
  document._fire("DOMContentLoaded");
  const text = (id) => document.getElementById(id).textContent;
  return { w, document, text };
}

test("preview page: renders the payload, shows its theme without storing it", () => {
  const src = makeEnv({ deviceKey: "devA" });
  const wallet = src.dbWalletStorage.loadWallet("max");
  src.dbWalletStorage.appendEvents(wallet, [src.dbWalletStorage.newEvent(wallet, "d", 3)]);
  const { w, document, text } = previewPage({ wallet: plain(wallet), theme: "Cyan Mist" });
  assert.equal(text("uid"), "max");
  assert.equal(text("unpaid"), "3");
  assert.equal(document.documentElement.getAttribute("data-theme"), "Teal Ember");
  assert.equal(w.localStorage.getItem("db-wallet:theme"), null);

  const bad = previewPage({ wallet: plain(wallet), theme: "x\" onload=\"" });
  assert.equal(bad.document.documentElement.getAttribute("data-theme"), "Lilac Carbon");
  assert.equal(bad.w.localStorage.getItem("db-wallet:theme"), null);
});

test("the no-wallet CSS keeps an open <dialog> visible", () => {
  const rule = CSS.match(/body\[data-no-wallet="1"\] > ([^{]+)\{/);
  assert.match(rule[1], /:not\(dialog\)/);
});

test("storage: walletBackupData is the shape wallet.html exports", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 2)]);
  x.globalActionCodes = [];
  x.deletedActionCodes = {};
  const data = plain(S.walletBackupData(x, "Paper Mint"));
  assert.deepEqual(Object.keys(data), [
    "userId", "walletId", "v", "seq", "events", "actionCodes",
    "globalActionCodes", "deletedActionCodes", "devices", "theme",
  ]);
  assert.equal(data.theme, "Paper Mint");
  assert.equal(S.walletBackupFileName("jörg x", "2026-11-17", "backup"), "db-wallet-j_rg_x-2026-11-17-backup.json");
  assert.equal(S.walletBackupFileName("max", "2026-11-17", ""), "db-wallet-max-2026-11-17.json");
});
