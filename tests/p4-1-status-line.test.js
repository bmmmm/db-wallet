// P4.1: one status line (#status-line, role="status" on #status-text) takes
// the success and error notices that used to be alert()s. After "+ Trinken"
// it says what was booked and what is open, so a double tap is visible, and
// offers "Rückgängig" for exactly that booking. Errors go there too (marked
// is-error); a page without the line falls back to alert(). O3.3: a save that
// trims codes/devices after merging another tab's copy says so. O3.4: the
// first "Teilen" explains that the link is the key to the whole wallet.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage } = require("./wallet-page");
const { makeEnv, makeStorage, plain, REPO } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

function status(w) {
  const d = w.document;
  const line = d.getElementById("status-line");
  return {
    text: d.getElementById("status-text").textContent,
    visible: line.classList.contains("is-visible"),
    error: line.classList.contains("is-error"),
    action: d.getElementById("status-action"),
  };
}

function seedOpen(n) {
  return (e) => {
    const S = e.dbWalletStorage;
    const x = S.loadWallet("max");
    S.appendEvents(x, [S.newEvent(x, "d", n)]);
  };
}

const unpaid = (w) => w.document.getElementById("unpaid").textContent;

test("wallet.html and index.html have one status line; the sync line is not live", () => {
  for (const page of ["wallet.html", "index.html"]) {
    const html = fs.readFileSync(path.join(REPO, page), "utf8");
    assert.match(html, /<div id="status-line" class="status-line">/, page);
    assert.equal((html.match(/id="status-text"[^>]*role="status"/g) || []).length, 1, page);
  }
  const sync = fs.readFileSync(path.join(REPO, "wallet-sync-ui.js"), "utf8");
  assert.doesNotMatch(sync, /aria-live/);
});

test("+ Trinken: the status line says what was booked; a double tap shows", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(3) });
  w.document.getElementById("btn-drink").click();
  let s = status(w);
  assert.equal(s.text, "+1 gebucht · Offen: 4");
  assert.ok(s.visible && !s.error);
  assert.equal(s.action.textContent, "Rückgängig");
  assert.equal(s.action.hidden, false);
  w.document.getElementById("btn-drink").click();
  assert.equal(status(w).text, "+1 gebucht · Offen: 5");
  assert.deepEqual(plain(w._alerts), []);
});

test("Rückgängig in the status line removes exactly that booking", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(3) });
  w.document.getElementById("amount").value = "2";
  w.document.getElementById("btn-drink").click();
  assert.equal(status(w).text, "+2 gebucht · Offen: 5");
  // Another tab books 5 in between; "Rückgängig" must not hit that one.
  const tab2 = makeEnv({ storage, deviceKey: "devB" });
  const S2 = tab2.dbWalletStorage;
  const other = S2.loadWallet("max");
  assert.equal(S2.appendEvents(other, [S2.newEvent(other, "d", 5)]), true);
  status(w).action.click();
  assert.equal(status(w).text, "Buchung zurückgenommen · Offen: 8");
  assert.equal(unpaid(w), "8");
  // A second click (the action is gone) cannot remove anything else.
  assert.equal(status(w).action.hidden, true);
});

test("credit: a typo is an error in the status line, not an alert", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  w.document.getElementById("btn-pay").click();
  w.document.getElementById("btn-credit").click();
  // A number input turns a typo into "" (P4.3: the form replaced prompt()).
  w.document.getElementById("credit-amount").value = "";
  w.document.getElementById("credit-form").dispatch("submit");
  const s = status(w);
  assert.equal(s.text, "Ungültige Menge für die Gutschrift.");
  assert.ok(s.error);
  assert.equal(s.action.hidden, true);
  assert.deepEqual(plain(w._alerts), []);
});

test("credit and pay report the result", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(3) });
  w.document.getElementById("btn-pay").click();
  w.document.getElementById("btn-credit").click();
  w.document.getElementById("credit-amount").value = "10";
  w.document.getElementById("credit-form").dispatch("submit");
  assert.equal(status(w).text, "Guthaben +10 gebucht · Guthaben: 7");
  w.document.getElementById("btn-drink").click();
  assert.equal(status(w).text, "+1 gebucht · Guthaben: 6");
});

test("full storage: the booking error is in the status line", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(1) });
  storage.quota = 10;
  w.document.getElementById("btn-drink").click();
  const s = status(w);
  assert.match(s.text, /Speichern fehlgeschlagen/);
  assert.ok(s.error);
  assert.equal(unpaid(w), "1");
  assert.deepEqual(plain(w._alerts), []);
});

test("wallet reset in another tab: the booking says reload, with a button", async () => {
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(1) });
  const tab2 = makeEnv({ storage, deviceKey: "devA" });
  const { ctx } = makeActionsCtx(tab2, tab2.dbWalletStorage.loadWallet("max"));
  tab2.dbWalletActions.resetWallet(ctx);
  w.document.getElementById("btn-drink").click();
  const s = status(w);
  assert.match(s.text, /anderen Tab zurückgesetzt/);
  assert.doesNotMatch(s.text, /Speicher voll/);
  assert.equal(s.action.textContent, "Neu laden");
  s.action.click();
  assert.equal(w._nav.pageLoads.length, 1, "reloads the page");
  assert.deepEqual(plain(w._alerts), []);
});

test("a global code reports what it booked", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOpen(1) });
  const AC = w.dbWalletActionCodes;
  const hash = AC.buildActionUrl(
    w.dbWalletStorage.loadWallet("max"),
    { scope: "global", type: "d", amount: 2, label: "Runde" },
    "https://example.invalid/wallet.html",
  ).split("#")[1];
  const res = w.dbWalletUi.applyGlobalActionHash(hash, {});
  assert.equal(res.applied, true);
  assert.equal(status(w).text, "„Runde“: +2 gebucht · Offen: 3");
});

test("without a status line, notify falls back to alert", () => {
  const w = makeEnv();
  assert.equal(w.dbWalletHelpers.notify("Hallo", { kind: "error" }), false);
  assert.deepEqual(plain(w._alerts), ["Hallo"]);
});

test("O3.3: a save that trims after merging another tab says so", () => {
  const storage = makeStorage();
  const tabA = makeEnv({ storage, deviceKey: "devA" });
  const tabB = makeEnv({ storage, deviceKey: "devA" });
  const SA = tabA.dbWalletStorage;
  const AC = tabA.dbWalletActionCodes;
  const base = SA.loadWallet("max");
  base.actionCodes = Array.from({ length: 6 }, (_, i) =>
    AC.buildActionCode({ type: "d", amount: 1, label: "A" + i }, 1000 + i),
  );
  assert.equal(SA.saveWallet(base), true);
  const a = SA.loadWallet("max");
  const b = tabB.dbWalletStorage.loadWallet("max");
  for (let i = 0; i < 4; i++) {
    a.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "B" + i }, 2000 + i));
    b.actionCodes.push(AC.buildActionCode({ type: "d", amount: 1, label: "C" + i }, 3000 + i));
  }
  assert.equal(SA.saveWallet(a), true);
  assert.deepEqual(plain(tabB._alerts), []);
  assert.equal(tabB.dbWalletStorage.saveWallet(b), true);
  assert.equal(JSON.parse(storage.getItem("db-wallet:max")).actionCodes.length, 10);
  assert.equal(tabB._alerts.length, 1, plain(tabB._alerts).join(" | "));
  assert.match(tabB._alerts[0], /4 Action Codes/);
  assert.match(tabB._alerts[0], /anderen Tab/);
  // Quiet saves (imports, internal writes) stay quiet; the next save has
  // nothing left to trim.
  assert.equal(tabB.dbWalletStorage.saveWallet(b), true);
  assert.equal(tabB._alerts.length, 1);
});

function shareFake() {
  const shared = [];
  return {
    shared,
    nav: {
      share(data) {
        shared.push(data.url);
        return Promise.resolve();
      },
      clipboard: { writeText: () => Promise.resolve() },
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test("O3.4: the first Teilen explains the link first, then shares on request", async () => {
  const fake = shareFake();
  const storage = makeStorage();
  const w = await bootWalletPage({ hash: "max", storage, seed: seedOpen(1) });
  w.navigator = fake.nav;
  const d = w.document;
  d.getElementById("btn-export").click();
  d.getElementById("btn-export-link").click();
  d.getElementById("btn-share-export-url").click();
  await settle();
  assert.deepEqual(fake.shared, [], "not shared before the hint");
  const s = status(w);
  assert.match(s.text, /ganzes Wallet/);
  assert.equal(s.action.textContent, "Teilen");
  s.action.click();
  await settle();
  assert.equal(fake.shared.length, 1);
  // Seen once on this device: the next Teilen shares directly.
  d.getElementById("btn-share-export-url").click();
  await settle();
  assert.equal(fake.shared.length, 2);

  const again = await bootWalletPage({ hash: "max", storage });
  again.navigator = fake.nav;
  again.document.getElementById("btn-export").click();
  again.document.getElementById("btn-export-link").click();
  again.document.getElementById("btn-share-export-url").click();
  await settle();
  assert.equal(fake.shared.length, 3, "the hint is shown once per device");
});
