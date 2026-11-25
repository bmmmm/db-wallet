// P4.4: "Historie" is a list of the visible entries (newest first), each
// with "Bearbeiten" and "Löschen" once "Einträge bearbeiten oder löschen" is
// on. The actions target the entry's root id, so no position number has to be
// read off and typed in, and a booking in another tab in between cannot shift
// the target. Deletions (tombstones) and replaced versions show only in the
// Raw-Log. P4.3: editing is an inline form with type="date" and
// type="number"; P4.9: it takes the focus and gives it back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bootWalletPage, statusText } = require("./wallet-page");
const { makeEnv, makeStorage, plain, settle, REPO } = require("./harness");
const { findAll, find } = require("./fake-dom");

const $ = (w, id) => w.document.getElementById(id);
const DAY = 86400000;

function rows(w) {
  return findAll($(w, "history-list"), (el) => el.tagName === "LI" && el.classList.contains("history-row"));
}
const rowText = (li) => find(li, (el) => el.classList.contains("history-row-text")).textContent;
const btn = (root, label) =>
  find(root, (el) => el.tagName === "BUTTON" && el.textContent === label);
const editForm = (li) => find(li, (el) => el.tagName === "FORM");
const inputOf = (form, type) => find(form, (el) => el.tagName === "INPUT" && el.type === type);

// Three entries on three days: 2 drinks (3 days ago), a pay (2 days ago),
// 1 drink (yesterday); ids in time order.
function seedThree(e) {
  const S = e.dbWalletStorage;
  const x = S.loadWallet("max");
  const now = Date.now();
  const a = S.newEvent(x, "d", 2);
  a.ts = now - 3 * DAY;
  const p = S.newEvent(x, "p");
  p.ts = now - 2 * DAY;
  const b = S.newEvent(x, "d", 1);
  b.ts = now - DAY;
  S.appendEvents(x, [a, p, b]);
}

async function openLog(opts) {
  const w = await bootWalletPage(Object.assign({ hash: "max", seed: seedThree }, opts));
  $(w, "mode-log").click();
  $(w, "log-edit-toggle").checked = true;
  $(w, "log-edit-toggle").dispatch("change");
  return w;
}

test("wallet.html: a list instead of position numbers", () => {
  const html = fs.readFileSync(path.join(REPO, "wallet.html"), "utf8");
  assert.match(html, /<ol id="history-list" class="history-list\b/);
  for (const gone of ["delete-range", "btn-edit-entry", "btn-selection-delete"]) {
    assert.doesNotMatch(html, new RegExp(`id="${gone}"`), gone);
  }
  assert.match(html, /Einträge bearbeiten oder löschen/);
  const summary = fs.readFileSync(path.join(REPO, "wallet-summary.js"), "utf8");
  assert.doesNotMatch(summary, /parseDeleteRange/);
});

test("Historie lists visible entries newest first; actions only when switched on", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedThree });
  $(w, "mode-log").click();
  assert.equal($(w, "history-list").style.display, "block");
  assert.equal($(w, "history").style.display, "none");
  assert.equal($(w, "mode-log").getAttribute("aria-pressed"), "true");
  assert.equal($(w, "mode-diagram").getAttribute("aria-pressed"), "false");
  const list = rows(w);
  assert.equal(list.length, 3);
  assert.match(rowText(list[0]), /1 Getränk$/);
  assert.match(rowText(list[1]), /Bezahlung$/);
  assert.match(rowText(list[2]), /2 Getränke$/);
  assert.equal(btn(list[0], "Bearbeiten"), null, "no actions before the switch");
  $(w, "log-edit-toggle").checked = true;
  $(w, "log-edit-toggle").dispatch("change");
  assert.ok(btn(rows(w)[0], "Bearbeiten"));
  assert.ok(btn(rows(w)[0], "Löschen"));
  // Diagram and raw use the <pre>; the list is hidden there.
  $(w, "mode-raw").click();
  assert.equal($(w, "history-list").style.display, "none");
  assert.equal($(w, "history").style.display, "block");
});

test("Löschen removes exactly that entry (its root), after the dialog", async () => {
  const w = await openLog();
  const asked = [];
  w.confirm = (m) => {
    asked.push(String(m));
    return true;
  };
  const oldest = rows(w)[2];
  btn(oldest, "Löschen").click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /2 Getränke/);
  assert.equal(rows(w).length, 2);
  assert.ok(!rows(w).some((li) => /2 Getränke$/.test(rowText(li))));
  assert.match(statusText(w), /^Eintrag gelöscht · Offen: 1$/);
  // The tombstone shows only in the Raw-Log.
  const ev = w.dbWalletStorage.loadWallet("max").events;
  const tomb = ev.find((e) => e.t === "x");
  assert.equal(tomb.ref, ev.find((e) => e.t === "d" && e.n === 2).id);
});

test("deleting a pay says how many drinks open again; Abbrechen keeps it", async () => {
  const w = await openLog();
  const asked = [];
  w.confirm = (m) => {
    asked.push(String(m));
    return false;
  };
  btn(rows(w)[1], "Löschen").click();
  await settle();
  assert.match(asked[0], /Bezahlung/);
  assert.match(asked[0], /2 Getränke wieder offen/);
  assert.equal(rows(w).length, 3);
  assert.equal($(w, "unpaid").textContent, "1");
});

test("Bearbeiten: inline form with date and number, saves a replacement", async () => {
  const w = await openLog();
  btn(rows(w)[0], "Bearbeiten").click();
  const form = editForm(rows(w)[0]);
  assert.ok(form, "form opened in the row");
  const date = inputOf(form, "date");
  const amount = inputOf(form, "number");
  assert.equal(date.value, w.dbWalletSummary.dateStrFromTimestamp(Date.now() - DAY));
  assert.equal(date.max, w.dbWalletSummary.todayDateStr());
  assert.equal(amount.value, "1");
  assert.equal(amount.max, "99");
  amount.value = "4";
  form.dispatch("submit");
  assert.match(statusText(w), /^Eintrag geändert · Offen: 4$/);
  assert.equal(rows(w).length, 3, "replaced, not added");
  assert.match(rowText(rows(w)[0]), /4 Getränke/);
  assert.match(rowText(rows(w)[0]), /bearbeitet/);
  assert.equal(editForm(rows(w)[0]), null, "form closed");
  const evs = w.dbWalletStorage.loadWallet("max").events;
  const orig = evs.find((e) => e.t === "d" && e.n === 1);
  const repl = evs.find((e) => e.supersedes === orig.id);
  assert.equal(repl.n, 4);
  assert.equal(repl.ts, orig.ts, "same date: the time is kept too");
});

test("editing an edited entry targets the root; delete then removes the chain", async () => {
  const w = await openLog();
  btn(rows(w)[0], "Bearbeiten").click();
  let form = editForm(rows(w)[0]);
  inputOf(form, "number").value = "3";
  form.dispatch("submit");
  btn(rows(w)[0], "Bearbeiten").click();
  form = editForm(rows(w)[0]);
  assert.equal(inputOf(form, "number").value, "3");
  inputOf(form, "number").value = "5";
  form.dispatch("submit");
  const evs = w.dbWalletStorage.loadWallet("max").events;
  const root = evs.find((e) => e.t === "d" && e.n === 1).id;
  assert.equal(evs.filter((e) => e.supersedes === root).length, 2);
  w.confirm = () => true;
  btn(rows(w)[0], "Löschen").click();
  await settle();
  assert.equal(rows(w).length, 2);
  const tomb = w.dbWalletStorage.loadWallet("max").events.find((e) => e.t === "x");
  assert.equal(tomb.ref, root);
});

test("edit errors keep the form open: future date, across a pay, too many", async () => {
  const w = await openLog();
  btn(rows(w)[2], "Bearbeiten").click();
  const form = editForm(rows(w)[2]);
  const date = inputOf(form, "date");
  const amount = inputOf(form, "number");
  date.value = "2999-01-01";
  form.dispatch("submit");
  assert.match(statusText(w), /Zukunft/);
  assert.ok(editForm(rows(w)[2]), "still open");
  // Moving the 2 drinks (before the pay) to yesterday would re-open them.
  date.value = w.dbWalletSummary.dateStrFromTimestamp(Date.now() - DAY);
  form.dispatch("submit");
  assert.match(statusText(w), /über eine Bezahlung/);
  date.value = w.dbWalletSummary.dateStrFromTimestamp(Date.now() - 3 * DAY);
  amount.value = "100";
  form.dispatch("submit");
  assert.equal(statusText(w), "Höchstens 99 Getränke auf einmal.");
  date.value = "";
  amount.value = "2";
  form.dispatch("submit");
  assert.equal(statusText(w), "Bitte ein Datum wählen.");
  assert.equal(w.dbWalletStorage.loadWallet("max").events.length, 3, "nothing written");
});

test("a pay row edits only the date (no amount field)", async () => {
  const w = await openLog();
  btn(rows(w)[1], "Bearbeiten").click();
  const form = editForm(rows(w)[1]);
  assert.ok(inputOf(form, "date"));
  assert.equal(inputOf(form, "number"), null);
});

test("the date field takes the focus; Abbrechen closes and gives it back", async () => {
  const w = await openLog();
  const focused = [];
  const origCreate = w.document.createElement;
  w.document.createElement = (tag) => {
    const el = origCreate(tag);
    el.focus = () => focused.push(el.tagName + (el.type ? ":" + el.type : "") + " " + el.textContent);
    return el;
  };
  btn(rows(w)[0], "Bearbeiten").click();
  assert.deepEqual(focused, ["INPUT:date "]);
  assert.equal(btn(rows(w)[0], "Bearbeiten").getAttribute("aria-expanded"), "true");
  btn(editForm(rows(w)[0]), "Abbrechen").click();
  assert.equal(editForm(rows(w)[0]), null);
  assert.deepEqual(focused.slice(1), ["BUTTON:button Bearbeiten"]);
  assert.equal(btn(rows(w)[0], "Bearbeiten").getAttribute("aria-expanded"), "false");
  // After a save the focus is back on the row's button as well.
  btn(rows(w)[0], "Bearbeiten").click();
  const form = editForm(rows(w)[0]);
  inputOf(form, "number").value = "2";
  form.dispatch("submit");
  assert.equal(focused[focused.length - 1], "BUTTON:button Bearbeiten");
  w.document.createElement = origCreate;
});

test("another tab books in between: the open form still edits its entry", async () => {
  const storage = makeStorage();
  const w = await openLog({ storage });
  btn(rows(w)[2], "Bearbeiten").click();
  inputOf(editForm(rows(w)[2]), "number").value = "7";
  // Tab 2 books; the storage event re-renders this tab's list.
  const tab2 = makeEnv({ storage, deviceKey: "devB" });
  const S2 = tab2.dbWalletStorage;
  const other = S2.loadWallet("max");
  assert.equal(S2.appendEvents(other, [S2.newEvent(other, "d", 5)]), true);
  w._dispatch("storage", { key: "db-wallet:max" });
  assert.equal(rows(w).length, 4);
  // The form survived the re-render, with what was typed, on the same entry.
  const li = rows(w)[3];
  const form = editForm(li);
  assert.ok(form, "form kept open");
  assert.equal(inputOf(form, "number").value, "7");
  form.dispatch("submit");
  const evs = w.dbWalletStorage.loadWallet("max").events;
  const target = evs.find((e) => e.t === "d" && e.n === 2);
  assert.equal(evs.find((e) => e.supersedes === target.id).n, 7);
  assert.equal(evs.find((e) => e.n === 5).supersedes, undefined, "tab 2's booking untouched");
  assert.deepEqual(plain(w._alerts), []);
});

test("long logs: 200 rows, then 'Ältere anzeigen'", async () => {
  const w = await bootWalletPage({
    hash: "max",
    seed: (e) => {
      const S = e.dbWalletStorage;
      const x = S.loadWallet("max");
      const evs = [];
      for (let i = 0; i < 250; i++) {
        const ev = S.newEvent(x, "d", 1);
        ev.ts = Date.now() - (250 - i) * 60000;
        evs.push(ev);
      }
      S.appendEvents(x, evs);
    },
  });
  $(w, "mode-log").click();
  assert.equal(rows(w).length, 200);
  const more = btn($(w, "history-list"), "Ältere anzeigen (50)");
  assert.ok(more);
  more.click();
  assert.equal(rows(w).length, 250);
  assert.equal(btn($(w, "history-list"), "Ältere anzeigen (50)"), null);
});
