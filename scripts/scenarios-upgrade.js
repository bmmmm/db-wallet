// Upgrade scenarios between two releases of the app (scripts/upgrade-check.js).
// Pure module: no git, no process exit. runScenarios({ oldRoot, newRoot })
// loads the modules of both directories into the vm harness (tests/harness.js,
// tests/wallet-page.js) and measures what happens between old and new
// devices/tabs: storage, QR/link, JSON backup, order, the first start after a
// deploy (new page, old cached scripts) and the update notice.
// Every result: { id, pfad, erwartung, beobachtet, klasse } with klasse
// OK | HINWEIS (behaviour changes, no data gone) | DATENVERLUST (an event id
// is missing, the summary differs, an action code or the deletion list is
// gone, or a deleted code is back).
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, DEFAULT_FILES } = require("../tests/harness");
const { bootWalletPage, BASE } = require("../tests/wallet-page");
const { makePageDocument, findAll } = require("../tests/fake-dom");

const USER = "max";
// 2026-11-10 12:00:00 UTC — every vm context runs on this fixed clock.
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const MIN = 60000;
const DAY = 24 * 60 * MIN;
const KEY = "db-wallet:" + USER;

// --- vm setup ---------------------------------------------------------------

// Runs first in every context (guarded, so it can prefix every page script):
// a fixed clock (Date.now and `new Date()`), a quiet console, an error list,
// and listeners on window/document that report errors instead of throwing
// (in a browser an error in one script or handler does not stop the others).
function prelude(now) {
  return `(function () {
  if (globalThis.__dbwSetNow) return;
  const Real = Date;
  let now = ${now};
  function FixedDate(...a) {
    if (!new.target) return new Real(now).toString();
    return a.length ? new Real(...a) : new Real(now);
  }
  FixedDate.prototype = Real.prototype;
  FixedDate.now = () => now;
  FixedDate.UTC = Real.UTC;
  FixedDate.parse = Real.parse;
  globalThis.Date = FixedDate;
  globalThis.__dbwSetNow = (t) => { now = t; };
  globalThis.__dbwErrors = [];
  globalThis.__dbwLog = [];
  const log = (kind) => (...a) => { globalThis.__dbwLog.push(kind + ": " + a.map(String).join(" ")); };
  globalThis.console = { log: log("log"), info: log("info"), debug: log("debug"), warn: log("warn"), error: log("error") };
  const record = (file, phase, e) => {
    globalThis.__dbwErrors.push({ file: String(file || "?"), phase, message: String((e && e.message) || e) });
  };
  globalThis.__dbwRecord = record;
  const wrapTarget = (t) => {
    if (!t || typeof t.addEventListener !== "function") return;
    const add = t.addEventListener;
    const remove = t.removeEventListener;
    const wrapped = new Map();
    t.addEventListener = function (type, fn, o) {
      const file = globalThis.__dbwFile;
      const g = function (ev) {
        try {
          const r = fn.call(this, ev);
          if (r && typeof r.then === "function") {
            return r.then(undefined, (e) => record(file, type, e));
          }
          return r;
        } catch (e) {
          record(file, type, e);
        }
      };
      wrapped.set(fn, g);
      return add.call(this, type, g, o);
    };
    if (typeof remove === "function") {
      t.removeEventListener = function (type, fn, o) {
        return remove.call(this, type, wrapped.get(fn) || fn, o);
      };
    }
  };
  wrapTarget(globalThis);
  wrapTarget(globalThis.document);
})();
`;
}

const sources = new Map();
function read(root, f) {
  const k = path.join(root, f);
  if (!sources.has(k)) sources.set(k, fs.readFileSync(k, "utf8"));
  return sources.get(k);
}

// One script as the page would run it: errors while loading are recorded,
// the next script still runs.
function wrapScript(f, src, now) {
  const name = JSON.stringify(f);
  return (
    prelude(now) +
    `globalThis.__dbwFile = ${name};\ntry {\n${src}\n} catch (e) { globalThis.__dbwRecord(${name}, "load", e); }\n`
  );
}

function moduleFiles(root) {
  return DEFAULT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
}

// A logic env (no page) on the modules of `root`.
function env(root, opts = {}) {
  const w = makeEnv({
    storage: opts.storage,
    deviceKey: opts.deviceKey || "devA",
    document: opts.document,
    globals: opts.globals,
    url: opts.url,
    files: [],
    root,
  });
  w._eval(prelude(opts.now || T0));
  for (const f of opts.files || moduleFiles(root)) w._eval(read(root, f), f);
  return w;
}

const setNow = (w, t) => w.__dbwSetNow(t);
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await tick();
}
// Polls cond() every 5 ms, at most 5 s.
async function until(cond) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
}
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const vmJson = (w, text) => w._eval("JSON.parse")(text);

// --- writing with the writer's own API ---------------------------------------

// The writer's API, old or new: newEvent/appendEvents, buildTombstoneEvent, and
// the action-code functions. Where the old release lacks a function, its
// counterpart is used (docs/upgrade-compat.md, "Aufbau").
function writer(w) {
  const S = w.dbWalletStorage;
  const AC = w.dbWalletActionCodes;
  const H = w.dbWalletHelpers;
  const save = (x) => {
    if (!S.saveWallet(x)) throw new Error("saveWallet refused");
    return S.loadWallet(USER);
  };
  return {
    load: () => S.loadWallet(USER),
    book(x, t, n) {
      const ev = S.newEvent(x, t, n);
      if (!S.appendEvents(x, [ev])) throw new Error("appendEvents refused");
      return ev.id;
    },
    // New: newEvent(wallet, t, n, { supersedes }) lifts the seq. Old: newEvent
    // has no options; the old editEntry minted the replacement with the next id
    // and set supersedes itself — the same here on top of newEvent.
    edit(x, rootId, n, ts) {
      const target = x.events.find((e) => e.id === rootId);
      let ev;
      if (S.newEvent.length >= 4) {
        ev = S.newEvent(x, target.t, n, { supersedes: rootId });
      } else {
        ev = S.newEvent(x, target.t, n);
        ev.supersedes = rootId;
      }
      ev.ts = typeof ts === "number" ? ts : target.ts;
      if (!S.appendEvents(x, [ev])) throw new Error("appendEvents refused");
      return ev.id;
    },
    remove(x, rootId) {
      const ev = S.buildTombstoneEvent(x, rootId);
      if (!S.appendEvents(x, [ev])) throw new Error("appendEvents refused");
      return ev.id;
    },
    // New: createActionCode(wallet, change).wallet. Old: buildActionCode +
    // push + ensureWalletActionCodes for a local code; a global code like the
    // old panel's (unexported) buildGlobalCode, through normalizeGlobalActionCodes.
    addCode(x, scope, type, amount, label) {
      if (typeof AC.createActionCode === "function") {
        const res = AC.createActionCode(x, { scope, type, amount: String(amount), label });
        save(res.wallet);
        return res.code.id;
      }
      if (scope === "global") {
        const id = "global:" + H.randomToken(10);
        x.globalActionCodes = AC.normalizeGlobalActionCodes(
          (x.globalActionCodes || []).concat([
            { id, label, amount, type, scope: "global", createdAt: Date.now(), updatedAt: Date.now() },
          ]),
        );
        save(x);
        return id;
      }
      const code = AC.buildActionCode({ type, amount: String(amount), label });
      if (!Array.isArray(x.actionCodes)) x.actionCodes = [];
      x.actionCodes.push(code);
      AC.ensureWalletActionCodes(x);
      save(x);
      return code.id;
    },
    // removeActionCode in both releases (the new panel goes through
    // deleteActionCode, which calls it).
    dropCode(x, id) {
      AC.removeActionCode(x, id);
      return save(x);
    },
  };
}

// Data set D: wallet "max", device devA. Credit 5 two days before, three
// drinks (d1 and d2 in one minute), a pay, d3 after the pay; an edit (d1:
// 2 -> 4), a delete (d3); a local and a global action code, and a code deleted
// via removeActionCode. Summary: unpaid 0, total 7, credit 0 (without the
// delete: 1/8/0, without the edit: 0/5/0).
// opts.withDelete (default true); opts.beforeDrop(storage-snapshot) runs
// right before the code is deleted.
function writeD(w, opts = {}) {
  const withDelete = opts.withDelete !== false;
  const api = writer(w);
  const ids = {};
  let x = api.load();
  setNow(w, T0 - 2 * DAY);
  ids.g = api.book(x, "g", 5);
  setNow(w, T0 + 10000);
  ids.d1 = api.book(x, "d", 2);
  setNow(w, T0 + 40000);
  ids.d2 = api.book(x, "d", 3);
  setNow(w, T0 + 10 * MIN);
  ids.p = api.book(x, "p");
  setNow(w, T0 + 20 * MIN);
  ids.d3 = api.book(x, "d", 1);
  setNow(w, T0 + 25 * MIN);
  const codes = {};
  codes.local = api.addCode(api.load(), "local", "d", 2, "Lokal");
  codes.global = api.addCode(api.load(), "global", "g", 5, "Global");
  codes.removed = api.addCode(api.load(), "local", "d", 1, "Weg");
  if (opts.beforeDrop) opts.beforeDrop(w.localStorage.getItem(KEY));
  setNow(w, T0 + 26 * MIN);
  api.dropCode(api.load(), codes.removed);
  setNow(w, T0 + 30 * MIN);
  x = api.load();
  ids.edit = api.edit(x, ids.d1, 4);
  if (withDelete) {
    setNow(w, T0 + 31 * MIN);
    ids.del = api.remove(x, ids.d3);
  }
  return { ids, codes };
}

// --- measuring --------------------------------------------------------------

function view(w, x) {
  const sum = w.dbWalletSummary.computeSummarySafe(x);
  const code = (c) => ({
    id: c.id,
    label: c.label,
    amount: c.amount,
    type: c.type,
    key: c.key || "",
  });
  return plain({
    ids: (x.events || []).map((e) => e.id).sort(),
    summary: { unpaid: sum.unpaid, total: sum.total, credit: sum.credit },
    codes: (x.actionCodes || []).map(code),
    globals: (x.globalActionCodes || []).map(code),
    deleted: Object.keys(x.deletedActionCodes || {}).sort(),
    order: (sum.eventsSorted || []).filter((e) => e.t !== "x").map((e) => e.id),
  });
}

const fmtSum = (s) => `${s.unpaid}/${s.total}/${s.credit}`;

// What of `src` is missing in `dst`. parts: ids, summary, codes, globals,
// deleted, removed (ids of deleted codes that must not be there).
function compare(src, dst, parts, removed = []) {
  const loss = [];
  const ok = [];
  if (parts.includes("ids")) {
    const have = new Set(dst.ids);
    const missing = src.ids.filter((id) => !have.has(id));
    if (missing.length) loss.push(`Event-IDs fehlen: ${missing.length} von ${src.ids.length} (${missing.join(", ")})`);
    else ok.push(`IDs ${src.ids.length}/${src.ids.length}`);
  }
  if (parts.includes("summary")) {
    if (fmtSum(src.summary) !== fmtSum(dst.summary)) {
      loss.push(`Summary ${fmtSum(src.summary)} -> ${fmtSum(dst.summary)} (unpaid/total/credit)`);
    } else ok.push(`Summary gleich (${fmtSum(dst.summary)})`);
  }
  for (const list of ["codes", "globals"]) {
    if (!parts.includes(list)) continue;
    const name = list === "codes" ? "lokale Codes" : "globale Codes";
    const bad = [];
    for (const c of src[list]) {
      const d = dst[list].find((e) => e.id === c.id);
      if (!d) {
        bad.push(`„${c.label}“ fehlt`);
        continue;
      }
      const diff = ["label", "amount", "type", "key"].filter((k) => c[k] !== d[k]);
      if (diff.length) bad.push(`„${c.label}“: ${diff.join(",")} geändert`);
    }
    if (bad.length) loss.push(`${name}: ${bad.join("; ")}`);
    else ok.push(`${name} ${src[list].length}/${src[list].length}`);
  }
  if (parts.includes("deleted")) {
    const have = new Set(dst.deleted);
    const missing = src.deleted.filter((id) => !have.has(id));
    if (missing.length) loss.push(`Löschliste fehlt (${missing.length} von ${src.deleted.length})`);
    else ok.push(`Löschliste ${src.deleted.length}/${src.deleted.length}`);
  }
  if (removed.length) {
    const back = removed.filter((id) => dst.codes.concat(dst.globals).some((c) => c.id === id));
    if (back.length) loss.push(`gelöschter Code da (${back.length})`);
    else ok.push("gelöschter Code nicht da");
  }
  return { loss, ok };
}

function result(id, pfad, erwartung, cmp, notes = []) {
  const parts = [].concat(cmp ? cmp.loss : [], notes, cmp ? cmp.ok : []);
  const klasse = cmp && cmp.loss.length ? "DATENVERLUST" : notes.length ? "HINWEIS" : "OK";
  return { id, pfad, erwartung, beobachtet: parts.join("; "), klasse };
}

function notMeasured(id, pfad, erwartung, reason) {
  return { id, pfad, erwartung, beobachtet: `nicht gemessen: ${reason}`, klasse: "HINWEIS" };
}

const firstLine = (s) => String(s || "").split("\n")[0];

// --- QR/link -----------------------------------------------------------------

// The export link as wallet-export-ui.js builds it (encode, gzip, base64url).
async function exportLink(w) {
  const H = w.dbWalletHelpers;
  const raw = w.dbWalletImportV2.encodeImportV2Bytes(w.dbWalletStorage.loadWallet(USER), null);
  const gz = await H.gzipCompress(raw);
  return { codec: raw[3], hash: "i2:" + H.base64UrlEncodeBytes(gz) };
}

// The export link of a stored wallet record (a snapshot of KEY).
async function snapshotLink(root, snapshot) {
  const storage = makeStorage();
  storage.setItem(KEY, snapshot);
  return exportLink(env(root, { storage }));
}

// A device that imported the sender's link from before the code was deleted
// (it has the code), then imports `hash` (from after). Returns its view.
async function presynced(root, firstLink, hash) {
  const storage = makeStorage();
  await importLink(root, firstLink.hash, storage);
  return importLink(root, hash, storage);
}

// Opens the link on a fresh device (devR) of `root`: wallet.html's import path
// tryImportFromHash, without the preview dialog (persists directly).
async function importLink(root, hash, storage = makeStorage()) {
  const w = env(root, { storage, deviceKey: "devR", url: BASE + "#" + hash });
  const I = w.dbWalletImportV2;
  let code = "";
  try {
    await I.parseImportHashPayload(hash);
  } catch (e) {
    code = I.importErrorCode(e);
  }
  const res = await I.tryImportFromHash({});
  const stored = storage.getItem(KEY) !== null;
  return {
    w,
    code,
    imported: !!(res && res.userId),
    alerts: Array.from(w._alerts),
    view: stored ? view(w, w.dbWalletStorage.loadWallet(USER)) : null,
  };
}

// --- JSON backup ---------------------------------------------------------------

// index-ui.js importJsonFile without the dialog: buildImportedWallet,
// ensureDeviceSeq, saveWallet({ quiet: true }) — on a fresh device (devR).
function importJson(root, text, storage = makeStorage()) {
  const w = env(root, { storage, deviceKey: "devR" });
  const I = w.dbWalletImportV2;
  const S = w.dbWalletStorage;
  const built = I.buildImportedWallet(vmJson(w, text));
  S.ensureDeviceSeq(built.wallet);
  const saved = S.saveWallet(built.wallet, { quiet: true });
  return { saved, view: saved ? view(w, S.loadWallet(USER)) : null };
}

// The backup JSON of a release: storage.walletBackupData where it exists,
// otherwise wallet.html's Export -> JSON (the old wallet-ui.js exportJsonData).
async function backupJson(root, storage) {
  const probe = env(root, { storage });
  const S = probe.dbWalletStorage;
  if (typeof S.walletBackupData === "function") {
    return { via: "walletBackupData", text: JSON.stringify(S.walletBackupData(S.loadWallet(USER), null)) };
  }
  const page = await bootPage({ root, storage, from: () => root });
  const blobs = [];
  page.w.dbWalletHelpers.downloadBlob = (blob) => {
    blobs.push(blob);
    return true;
  };
  click(page.w, "btn-export");
  click(page.w, "btn-export-json");
  await settle();
  if (!blobs.length) return { via: "Export -> JSON", text: "" };
  return { via: "Export -> JSON", text: await blobs[0].text() };
}

// --- page boot ----------------------------------------------------------------

// Boots a wallet.html (`html`, default <root>/wallet.html) with every script
// taken from from(file) — a directory. Errors are recorded, not thrown.
async function bootPage({ root, html, storage, from, hash = USER }) {
  const scriptSource = (f) => wrapScript(f, read(from(f), f), T0 + 60 * MIN);
  const w = await bootWalletPage({ root, html, storage, hash, deviceKey: "devA", scriptSource });
  await settle();
  return { w };
}

function click(w, id) {
  const el = w.document.getElementById(id);
  if (!el) {
    w.__dbwRecord("(Test)", "click", `#${id} fehlt`);
    return false;
  }
  try {
    el.click();
  } catch (e) {
    w.__dbwRecord("Klick-Handler", `click #${id}`, e);
  }
  return true;
}

function storedEvents(storage) {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Array.isArray(obj.events) ? obj.events : [];
  } catch (e) {
    return [];
  }
}

const errText = (errs) =>
  errs.length
    ? errs.map((e) => `${e.file} (${e.phase}): ${e.message}`).join(" / ")
    : "keine";

// APP_SHELL of a service-worker.js, read from the file.
function appShell(root) {
  const src = read(root, "service-worker.js");
  const m = /APP_SHELL\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"\.\/([^"]*)"/g))
    .map((x) => x[1])
    .filter(Boolean);
}

// The old service-worker.js in a vm: install fills its cache from the old
// release ("alt"), then the network serves the new one ("neu"). Returns, per
// requested path, where the answer came from.
async function oldSwAnswers(oldRoot, requests) {
  const vm = require("vm");
  const scope = "https://example.invalid/";
  const cache = new Map();
  let phase = "alt";
  const listeners = {};
  const keyOf = (req, ignoreSearch) => {
    const url = new URL(typeof req === "string" ? req : req.url, scope).href;
    return ignoreSearch ? url.split("?")[0] : url;
  };
  const cacheObj = {
    addAll: (reqs) => {
      for (const r of reqs) cache.set(keyOf(r), "alt:" + new URL(keyOf(r)).pathname.slice(1));
      return Promise.resolve();
    },
    put: () => Promise.resolve(),
  };
  const ctx = vm.createContext({
    self: {
      location: { origin: "https://example.invalid" },
      addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: {
      open: () => Promise.resolve(cacheObj),
      match: (req, o) => {
        const k = keyOf(req, o && o.ignoreSearch);
        return Promise.resolve(cache.has(k) ? new Response(cache.get(k)) : undefined);
      },
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    fetch: (req) => Promise.resolve(new Response(phase + ":" + new URL(keyOf(req)).pathname.slice(1))),
    Request: function (url, init) {
      this.url = keyOf(url);
      this.cache = init && init.cache;
    },
    Response,
    Headers,
    URL,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && t.unref) t.unref();
      return t;
    },
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(read(oldRoot, "service-worker.js"), ctx, { filename: "service-worker.js" });
  const waits = [];
  for (const fn of listeners.install || []) fn({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  phase = "neu";
  const out = {};
  for (const { file, navigate } of requests) {
    let answer = null;
    const event = {
      request: {
        url: scope + file,
        method: "GET",
        mode: navigate ? "navigate" : "no-cors",
        headers: new Headers(navigate ? { accept: "text/html" } : {}),
      },
      respondWith: (p) => (answer = p),
      waitUntil: () => {},
    };
    for (const fn of listeners.fetch || []) fn(event);
    const body = answer ? await (await answer).text() : "ohne SW";
    out[file] = body.split(":")[0];
  }
  return out;
}

// --- scenarios --------------------------------------------------------------

async function s1(oldRoot, newRoot) {
  const storage = makeStorage();
  const { codes } = writeD(env(oldRoot, { storage }));
  const o = env(oldRoot, { storage });
  const src = view(o, o.dbWalletStorage.loadWallet(USER));
  const n = env(newRoot, { storage });
  const dst = view(n, n.dbWalletStorage.loadWallet(USER));
  return result(
    "S1",
    "Speicher: D vom alten Stand geschrieben, vom neuen geladen",
    "IDs, Summary, Codes, Löschliste gleich",
    compare(src, dst, ["ids", "summary", "codes", "globals", "deleted"], [codes.removed]),
  );
}

// Two tabs of one browser (same device devA, one storage) on D (old writes D).
// `first` books, edits, deletes an entry and a code; then the stale `second`
// tab (loaded before) saves one booking. Then both releases load again.
async function s2(oldRoot, newRoot, firstIsNew) {
  const storage = makeStorage();
  const { ids, codes } = writeD(env(oldRoot, { storage }));
  const tabOld = env(oldRoot, { storage, now: T0 + 35 * MIN });
  const tabNew = env(newRoot, { storage, now: T0 + 35 * MIN });
  const xo = tabOld.dbWalletStorage.loadWallet(USER);
  const xn = tabNew.dbWalletStorage.loadWallet(USER);
  const [first, xf, second, xs] = firstIsNew ? [tabNew, xn, tabOld, xo] : [tabOld, xo, tabNew, xn];
  const a = writer(first);
  setNow(first, T0 + 40 * MIN);
  a.book(xf, "d", 1);
  setNow(first, T0 + 41 * MIN);
  a.edit(xf, ids.d2, 5);
  setNow(first, T0 + 42 * MIN);
  a.remove(xf, ids.g);
  setNow(first, T0 + 43 * MIN);
  const xf2 = a.dropCode(first.dbWalletStorage.loadWallet(USER), codes.local);
  setNow(second, T0 + 45 * MIN);
  writer(second).book(xs, "d", 4);
  const expected = plain({
    ids: Array.from(new Set(xf2.events.map((e) => e.id).concat(xs.events.map((e) => e.id)))).sort(),
    deleted: [codes.removed, codes.local].sort(),
  });
  const src = { ids: expected.ids, deleted: expected.deleted, codes: [], globals: [] };
  const loss = [];
  const ok = [];
  for (const [name, root] of [["neu", newRoot], ["alt", oldRoot]]) {
    const r = env(root, { storage });
    const v = view(r, r.dbWalletStorage.loadWallet(USER));
    const c = compare(src, v, ["ids", "deleted"], [codes.removed, codes.local]);
    if (c.loss.length) loss.push(`${name} lädt: ${c.loss.join(", ")}`);
    else ok.push(`${name} lädt: ${c.ok.join(", ")}`);
  }
  const pfad = firstIsNew
    ? "Zwei Tabs: neu bucht/editiert/löscht Eintrag+Code, dann speichert der veraltete alte Tab"
    : "Zwei Tabs: alt bucht/editiert/löscht Eintrag+Code, dann speichert der veraltete neue Tab";
  return result(
    firstIsNew ? "S2a" : "S2b",
    pfad,
    "Events beider Tabs da, Löschliste da, gelöschter Code weg",
    { loss, ok },
  );
}

async function s3(oldRoot, newRoot) {
  const out = [];
  // a) D without the delete (with the edit)
  const sa = makeStorage();
  let snapA = "";
  const { codes } = writeD(env(newRoot, { storage: sa }), {
    withDelete: false,
    beforeDrop: (snap) => (snapA = snap),
  });
  const wa = env(newRoot, { storage: sa });
  const srcA = view(wa, wa.dbWalletStorage.loadWallet(USER));
  const linkA = await exportLink(wa);
  const impA = await importLink(oldRoot, linkA.hash);
  const head = (link, imp) =>
    `Codec ${link.codec}; Import ${imp.imported ? "ja" : "nein"}` +
    (imp.code ? `; Fehlercode ${imp.code}` : "") +
    (imp.imported ? "" : `; Meldung „${firstLine(imp.alerts[imp.alerts.length - 1])}“`) +
    `; Speicher danach: ${imp.view ? imp.view.ids.length + " Events" : "kein Wallet"}`;
  if (impA.view) {
    const c = compare(srcA, impA.view, ["ids", "summary", "codes"]);
    c.ok.unshift(head(linkA, impA));
    out.push(result("S3a", "QR/Link neu -> alt: D ohne Delete (mit Edit)", "Import, IDs/Summary/lokale Codes gleich", c));
  } else {
    out.push(result("S3a", "QR/Link neu -> alt: D ohne Delete (mit Edit)", "Import, IDs/Summary/lokale Codes gleich", null, [head(linkA, impA)]));
  }
  // b) D with the delete
  const sb = makeStorage();
  writeD(env(newRoot, { storage: sb }));
  const wb = env(newRoot, { storage: sb });
  const srcB = view(wb, wb.dbWalletStorage.loadWallet(USER));
  const linkB = await exportLink(wb);
  const impB = await importLink(oldRoot, linkB.hash);
  if (impB.imported && impB.view) {
    const c = compare(srcB, impB.view, ["ids", "summary", "codes"]);
    c.ok.unshift(head(linkB, impB));
    out.push(result("S3b", "QR/Link neu -> alt: D mit Delete", "Import, IDs (mit Tombstone)/Summary gleich", c));
  } else {
    out.push(
      result("S3b", "QR/Link neu -> alt: D mit Delete", "Import, IDs (mit Tombstone)/Summary gleich", null, [
        head(linkB, impB) + "; Quelle unverändert",
      ]),
    );
  }
  // c) the global code — on the import of a). d) the deletion list — on a
  // device that already has the deleted code (it imported the link from
  // before the deletion), importing the link of a).
  const pfadC = "QR/Link neu -> alt: globaler Code (Export aus S3a)";
  const pfadD = "QR/Link neu -> alt: Löschliste (Export aus S3a auf ein Gerät, das den gelöschten Code schon hat)";
  if (!impA.view) {
    out.push(notMeasured("S3c", pfadC, "globaler Code kommt an", "Import aus S3a gescheitert"));
    out.push(notMeasured("S3d", pfadD, "Löschliste kommt an", "Import aus S3a gescheitert"));
    return out;
  }
  out.push(result("S3c", pfadC, "globaler Code kommt an (ID, Label, Betrag, Typ, ohne Key)", compare(srcA, impA.view, ["globals"])));
  const preD = await presynced(oldRoot, await snapshotLink(newRoot, snapA), linkA.hash);
  out.push(
    preD.view
      ? result("S3d", pfadD, "Löschliste kommt an, gelöschter Code verschwindet", compare(srcA, preD.view, ["deleted"], [codes.removed]))
      : notMeasured("S3d", pfadD, "Löschliste kommt an", "Import gescheitert"),
  );
  return out;
}

async function s4(oldRoot, newRoot) {
  const storage = makeStorage();
  let snap = "";
  const { codes } = writeD(env(oldRoot, { storage }), { beforeDrop: (x) => (snap = x) });
  const w = env(oldRoot, { storage });
  const src = view(w, w.dbWalletStorage.loadWallet(USER));
  const link = await exportLink(w);
  const imp = await importLink(newRoot, link.hash);
  const pfad = "QR/Link alt -> neu: D mit Delete, alter Encoder, neuer Import";
  if (!imp.view) {
    const msg = `Codec ${link.codec}; Import nein; Fehlercode ${imp.code || "-"}; Meldung „${firstLine(imp.alerts[imp.alerts.length - 1])}“`;
    return [
      { id: "S4", pfad, erwartung: "IDs, Summary, Codes gleich", beobachtet: msg, klasse: "DATENVERLUST" },
      notMeasured("S4-dc", "QR/Link alt -> neu: Löschliste", "Löschliste kommt an", "Import aus S4 gescheitert"),
    ];
  }
  const c = compare(src, imp.view, ["ids", "summary", "codes", "globals"], [codes.removed]);
  c.ok.unshift(`Codec ${link.codec}; Import ja`);
  const pre = await presynced(newRoot, await snapshotLink(oldRoot, snap), link.hash);
  const pfadDc = "QR/Link alt -> neu: Löschliste (Export aus S4 auf ein Gerät, das den gelöschten Code schon hat)";
  return [
    result("S4", pfad, "IDs (mit Tombstone), Summary, Codes gleich, gelöschter Code bleibt weg", c),
    pre.view
      ? result("S4-dc", pfadDc, "Löschliste kommt an, gelöschter Code verschwindet", compare(src, pre.view, ["deleted"], [codes.removed]))
      : notMeasured("S4-dc", pfadDc, "Löschliste kommt an", "Import gescheitert"),
  ];
}

async function s5(oldRoot, newRoot) {
  const storage = makeStorage();
  const { ids } = writeD(env(newRoot, { storage }));
  // devB books in the minute of d1/d2 (T0+25 s).
  const b = env(newRoot, { storage, deviceKey: "devB", now: T0 + 25000 });
  writer(b).book(b.dbWalletStorage.loadWallet(USER), "d", 1);
  // devA moves the credit one day further back (same amount; crosses no pay,
  // so the new editEntry would accept it too).
  const a = env(newRoot, { storage, deviceKey: "devA", now: T0 + 50 * MIN });
  const x = a.dbWalletStorage.loadWallet(USER);
  const g = x.events.find((e) => e.id === ids.g);
  writer(a).edit(x, ids.g, 5, g.ts - DAY);
  const o = env(oldRoot, { storage, deviceKey: "devA" });
  const n = env(newRoot, { storage, deviceKey: "devA" });
  const vo = view(o, o.dbWalletStorage.loadWallet(USER));
  const vn = view(n, n.dbWalletStorage.loadWallet(USER));
  const c = compare(vo, vn, ["summary"]);
  const notes = [];
  const same = vo.order.join(",") === vn.order.join(",");
  if (!same) notes.push(`Reihenfolge weicht ab: alt ${vo.order.join(" ")}, neu ${vn.order.join(" ")}`);
  else c.ok.push(`Reihenfolge gleich (${vn.order.join(" ")})`);
  return result(
    "S5",
    "Reihenfolge: D + devB in derselben Minute + Edit auf den Vortag, alt vs. neu auf einem Speicher",
    "gleiche Reihenfolge und Summary",
    c,
    notes,
  );
}

async function s6(oldRoot, newRoot) {
  const out = [];
  const shell = new Set(appShell(oldRoot));
  const newHtml = read(newRoot, "wallet.html");
  const storage = makeStorage();
  writeD(env(oldRoot, { storage }));
  const reader = env(oldRoot, { storage });
  const before = view(reader, reader.dbWalletStorage.loadWallet(USER));
  const from = (f) => (shell.has(f) ? oldRoot : newRoot);
  // What the old service worker actually serves after the deploy.
  const refs = (re) => Array.from(newHtml.matchAll(re)).map((m) => m[1]);
  const pageScripts = refs(/<script src="(?:\.\/)?([^"]+)"/g);
  const pageCss = refs(/<link[^>]*rel="stylesheet"[^>]*href="(?:\.\/)?([^"]+)"/g);
  const lazy = ["qrcodegen.js"].filter((f) => fs.existsSync(path.join(newRoot, f)));
  const assets = pageScripts.concat(lazy, pageCss);
  const answers = await oldSwAnswers(
    oldRoot,
    [{ file: "wallet.html", navigate: true }].concat(assets.map((file) => ({ file }))),
  );
  const fromCache = assets.filter((f) => answers[f] === "alt");
  const fromNet = assets.filter((f) => answers[f] === "neu");
  const mismatch = assets.filter((f) => (answers[f] === "alt") !== shell.has(f));
  const swNotes = [];
  if (answers["wallet.html"] !== "neu") swNotes.push(`wallet.html kommt ${answers["wallet.html"]}`);
  if (mismatch.length) swNotes.push(`weicht vom APP_SHELL ab: ${mismatch.join(", ")}`);
  const swRes = result(
    "S6-sw",
    "Erster Start nach dem Deploy: alter service-worker.js (Cache aus dem alten Install) beantwortet die neue Seite",
    "wallet.html neu (Netz); Skripte/CSS aus dem alten APP_SHELL alt (Cache), andere neu",
    null,
    swNotes,
  );
  swRes.beobachtet =
    `wallet.html ${answers["wallet.html"]}; alt (Cache): ${fromCache.length} Dateien` +
    (pageCss.filter((f) => answers[f] === "alt").length ? ` inkl. ${pageCss.filter((f) => answers[f] === "alt").join(", ")}` : "") +
    `; neu (Netz): ${fromNet.join(", ") || "keine"}` +
    (swNotes.length ? `; ${swNotes.join("; ")}` : "");
  out.push(swRes);
  const oldCss = pageCss.filter((f) => answers[f] === "alt");
  const changedCss = oldCss.filter((f) => read(oldRoot, f) !== read(newRoot, f));
  if (changedCss.length) {
    out.push(
      notMeasured(
        "S6-css",
        "Mischstand: Darstellung der neuen wallet.html",
        "Layout wie im neuen Stand",
        `Fake-DOM ohne CSS/Layout; ${changedCss.join(", ")} (anders als im neuen Stand) ${changedCss.length > 1 ? "kommen" : "kommt"} aus dem alten Cache`,
      ),
    );
  } else {
    out.push({
      id: "S6-css",
      pfad: "Mischstand: Darstellung der neuen wallet.html",
      erwartung: "Layout wie im neuen Stand",
      beobachtet: `CSS aus dem alten Cache (${oldCss.join(", ") || "keins"}) gleicht dem neuen Stand Byte für Byte`,
      klasse: "OK",
    });
  }

  const page = await bootPage({ root: newRoot, html: newHtml, storage, from });
  const w = page.w;
  const doc = w.document;
  const bootErrors = Array.from(w.__dbwErrors).map(plain);
  const uid = doc.getElementById("uid") ? doc.getElementById("uid").textContent : "";
  const bootRes = result(
    "S6-boot",
    `Erster Start nach dem Deploy: neue wallet.html, Skripte aus dem alten APP_SHELL alt, sonst neu (${pageScripts.filter((f) => !shell.has(f)).join(", ") || "keins"}); Speicher mit D vom alten Stand`,
    "keine Exception, Wallet sichtbar (#uid)",
    null,
    [].concat(
      bootErrors.length ? [`Exceptions: ${errText(bootErrors)}`] : [],
      uid === USER ? [] : [`#uid „${uid}“ statt „${USER}“`],
    ),
  );
  if (!bootErrors.length && uid === USER) bootRes.beobachtet = `Exceptions: keine; #uid „${uid}“`;
  else if (uid === USER) bootRes.beobachtet += `; #uid „${uid}“`;
  out.push(bootRes);

  // Booking and undo on the page's own buttons.
  const errsBefore = w.__dbwErrors.length;
  const n0 = storedEvents(storage).length;
  w.__dbwSetNow(T0 + 61 * MIN);
  click(w, "btn-drink");
  await settle();
  const afterDrink = storedEvents(storage);
  const booked = afterDrink.length === n0 + 1 && afterDrink.some((e) => e.t === "d" && e.ts === T0 + 61 * MIN);
  w.__dbwSetNow(T0 + 62 * MIN);
  click(w, "btn-undo");
  await settle();
  const afterUndo = storedEvents(storage);
  const lastNew = afterUndo.slice(afterDrink.length);
  const undone = lastNew.length === 1 && lastNew[0].t === "x";
  const bookErrors = Array.from(w.__dbwErrors).slice(errsBefore).map(plain);
  const bookNotes = [];
  if (!booked) bookNotes.push(`Drink-Button bucht nicht (Events ${n0} -> ${afterDrink.length})`);
  if (!undone) bookNotes.push(`Rückgängig schreibt keinen Tombstone (Events ${afterDrink.length} -> ${afterUndo.length})`);
  if (bookErrors.length) bookNotes.push(`Exceptions: ${errText(bookErrors)}`);
  const bookRes = result("S6-buchen", "Mischstand: Drink-Button, dann Rückgängig", "Drink bucht ein Event, Rückgängig einen Tombstone", null, bookNotes);
  if (!bookNotes.length) bookRes.beobachtet = `Drink +1 Event (t d); Rückgängig +1 Tombstone`;
  out.push(bookRes);

  // Export QR.
  const errsQr = w.__dbwErrors.length;
  const alerts0 = w._alerts.length;
  const qrUrl = doc.getElementById("qr-url");
  const statusText = doc.getElementById("status-text");
  const status0 = statusText ? statusText.textContent : "";
  click(w, "btn-export");
  click(w, "btn-export-link-qr");
  // gzip runs on real time (CompressionStream): wait for the outcome, not a
  // fixed number of turns.
  await until(
    () => (qrUrl && qrUrl.value) || w._alerts.length > alerts0 || (statusText && statusText.textContent !== status0),
  );
  await settle();
  const canvas = doc.getElementById("qr-canvas");
  const drawn = !!(canvas && canvas.width > 100);
  const qrAlerts = Array.from(w._alerts).slice(alerts0);
  const qrErrors = Array.from(w.__dbwErrors).slice(errsQr).map(plain);
  const seen = []
    .concat(qrAlerts.map((a) => `alert „${firstLine(a)}“`))
    .concat(
      statusText && statusText.textContent && statusText.textContent !== status0
        ? [`Statuszeile „${firstLine(statusText.textContent)}“`]
        : [],
    );
  const qrNotes = [];
  if (!drawn) qrNotes.push(`QR nicht gezeichnet; Nutzer sieht: ${seen.join(", ") || "nichts"}`);
  if (qrErrors.length) qrNotes.push(`Exceptions: ${errText(qrErrors)}`);
  const linkShown = !!(qrUrl && /#i2u?:/.test(qrUrl.value || ""));
  // Without a QR the link: older releases behind the plain link button (what
  // their QR error points to), newer ones put it into #export-url themselves.
  const exportUrl = doc.getElementById("export-url");
  if (!drawn) {
    if (doc.getElementById("btn-export-link")) click(w, "btn-export-link");
    await until(() => exportUrl && exportUrl.value);
    const kind = exportUrl && /#(i2u?|import):/.exec(exportUrl.value || "");
    qrNotes.push(`Button „Link“ liefert ${kind ? `einen #${kind[1]}:-Link` : "keinen Link"}`);
  }
  const qrRes = result("S6-qr", "Mischstand: Export -> Link + QR", "QR gezeichnet", null, qrNotes);
  if (!qrNotes.length) qrRes.beobachtet = `QR gezeichnet, Link im Feld`;
  else qrRes.beobachtet += `; Link im QR-Feld: ${linkShown ? "ja" : "nein"}`;
  out.push(qrRes);

  // Action-code panel.
  const errsAc = w.__dbwErrors.length;
  const panel = doc.getElementById("action-codes-panel");
  if (panel) {
    panel.open = true;
    try {
      panel.dispatch("toggle");
    } catch (e) {
      w.__dbwRecord("action-codes-panel", "toggle", e);
    }
  }
  await settle(20);
  const body = doc.getElementById("action-codes-body");
  const cards = body ? findAll(body, (el) => el.classList.contains("action-code-card")) : [];
  const cardCanvases = body ? findAll(body, (el) => el.tagName === "CANVAS") : [];
  const drawnCards = cardCanvases.filter((c) => c.width > 100).length;
  const cardErrors = body
    ? Array.from(new Set(findAll(body, (el) => /error/.test(el.className) && el._text).map((el) => firstLine(el._text))))
    : [];
  const acErrors = Array.from(w.__dbwErrors).slice(errsAc).map(plain);
  const acNotes = [];
  if (cards.length !== 2) acNotes.push(`${cards.length} Code-Karten statt 2`);
  if (drawnCards !== cards.length) acNotes.push(`QR auf ${drawnCards} von ${cards.length} Karten gezeichnet`);
  if (cardErrors.length) acNotes.push(`Karte zeigt „${cardErrors.join("“, „")}“`);
  if (acErrors.length) acNotes.push(`Exceptions: ${errText(acErrors)}`);
  const acRes = result("S6-codes", "Mischstand: Action-Code-Panel öffnen", "2 Karten mit QR", null, acNotes);
  if (!acNotes.length) acRes.beobachtet = `${cards.length} Karten, QR gezeichnet`;
  out.push(acRes);

  // The store after the mixed session, loaded by the new release.
  const n = env(newRoot, { storage });
  const o = env(oldRoot, { storage });
  let loadRes;
  try {
    const vn = view(n, n.dbWalletStorage.loadWallet(USER));
    const vo = view(o, o.dbWalletStorage.loadWallet(USER));
    const expectIds = Array.from(new Set(before.ids.concat(storedEvents(storage).map((e) => e.id)))).sort();
    const c = compare(
      { ids: expectIds, summary: vo.summary, codes: before.codes, globals: before.globals, deleted: before.deleted },
      vn,
      ["ids", "summary", "codes", "globals", "deleted"],
    );
    loadRes = result("S6-laden", "Speicher nach dem Mischstand, vom neuen Stand geladen", "vollständig ladbar, Summary wie alt", c);
  } catch (e) {
    loadRes = {
      id: "S6-laden",
      pfad: "Speicher nach dem Mischstand, vom neuen Stand geladen",
      erwartung: "vollständig ladbar, Summary wie alt",
      beobachtet: `Laden wirft: ${String((e && e.message) || e)}`,
      klasse: "DATENVERLUST",
    };
  }
  out.push(loadRes);

  // S6b: the same store after "Aktualisieren" — everything new.
  const pageB = await bootPage({ root: newRoot, html: newHtml, storage, from: () => newRoot });
  const wb = pageB.w;
  const uidB = wb.document.getElementById("uid").textContent;
  const nb = storedEvents(storage).length;
  wb.__dbwSetNow(T0 + 70 * MIN);
  click(wb, "btn-drink");
  await settle();
  const bookedB = storedEvents(storage).length === nb + 1;
  const errsB2 = Array.from(wb.__dbwErrors).map(plain);
  const notesB = [];
  if (errsB2.length) notesB.push(`Exceptions: ${errText(errsB2)}`);
  if (uidB !== USER) notesB.push(`#uid „${uidB}“`);
  if (!bookedB) notesB.push("Drink-Button bucht nicht");
  const resB = result("S6b", "Nach „Aktualisieren“: derselbe Speicher, alles neu", "Boot ohne Exception, Buchung geht", null, notesB);
  if (!notesB.length) resB.beobachtet = `Exceptions: keine; #uid „${uidB}“; Drink +1 Event`;
  out.push(resB);
  return out;
}

async function s7(oldRoot, newRoot) {
  const swListeners = {};
  const navigator = {
    serviceWorker: {
      controller: {},
      addEventListener(type, fn) {
        (swListeners[type] = swListeners[type] || []).push(fn);
      },
      register() {
        return Promise.resolve({});
      },
    },
  };
  const document = makePageDocument(read(newRoot, "wallet.html"));
  const w = env(oldRoot, {
    document,
    globals: { navigator },
    files: ["wallet-helpers.js", "sw-register.js"],
    url: BASE + "#" + USER,
  });
  w._dispatch("load");
  for (const fn of swListeners.controllerchange || []) fn({ type: "controllerchange" });
  const body = document.body;
  const status = document.getElementById("status-text");
  const texts = findAll(body, (el) => el._text === "Neue Version verfügbar.");
  const buttons = findAll(body, (el) => el.tagName === "BUTTON" && el._text);
  const btn =
    buttons.find((b) => b._text === "Aktualisieren") ||
    buttons.find((b) => b._text === "Neu laden") ||
    (document.getElementById("status-action") && !document.getElementById("status-action").hidden
      ? document.getElementById("status-action")
      : null);
  const where = texts.length
    ? texts[0].id === "status-text"
      ? "Statuszeile"
      : "eigener Leiste"
    : "";
  const text = texts.length ? texts[0]._text : "";
  const label = btn ? String(btn.textContent || "").trim() : "";
  let reloads = 0;
  if (btn) {
    btn.click();
    reloads = w._nav.pageLoads.length;
  }
  const notes = [];
  if (!text) notes.push("kein Hinweis");
  if (!btn) notes.push("kein Button");
  else if (reloads !== 1) notes.push(`Klick lädt nicht neu (${reloads})`);
  const r = result("S7", "Update-Hinweis: altes sw-register.js mit Controller, controllerchange", "„Neue Version verfügbar.“ + Button, Klick lädt neu", null, notes);
  if (!notes.length) {
    r.beobachtet = `„${text}“ in ${where} + Button „${label}“; Klick: ${reloads} Neuladen (pageLoads)`;
  }
  return r;
}

// Fresh device: IDs, summary, codes. Deletion list: on a device that already
// imported the backup from before the code was deleted.
async function s8(oldRoot, newRoot) {
  const out = [];
  const want = "IDs, Summary, Codes, Löschliste gleich; gelöschter Code verschwindet";
  for (const [id, fromRoot, toRoot, pfad] of [
    ["S8a", oldRoot, newRoot, "JSON-Backup alt -> neu"],
    ["S8b", newRoot, oldRoot, "JSON-Backup neu -> alt"],
  ]) {
    const storage = makeStorage();
    let snap = "";
    const { codes } = writeD(env(fromRoot, { storage }), { beforeDrop: (x) => (snap = x) });
    const backup = await backupJson(fromRoot, storage);
    const w = env(fromRoot, { storage });
    const src = view(w, w.dbWalletStorage.loadWallet(USER));
    const snapStorage = makeStorage();
    snapStorage.setItem(KEY, snap);
    const early = await backupJson(fromRoot, snapStorage);
    if (!backup.text || !early.text) {
      out.push(notMeasured(id, pfad, want, `kein Backup erzeugt (${backup.via})`));
      continue;
    }
    const imp = importJson(toRoot, backup.text);
    const preStorage = makeStorage();
    importJson(toRoot, early.text, preStorage);
    const pre = importJson(toRoot, backup.text, preStorage);
    if (!imp.view || !pre.view) {
      out.push({ id, pfad, erwartung: want, beobachtet: `Import speichert nicht (${backup.via})`, klasse: "DATENVERLUST" });
      continue;
    }
    const c = compare(src, imp.view, ["ids", "summary", "codes", "globals"]);
    const d = compare(src, pre.view, ["deleted"], [codes.removed]);
    const tag = "Gerät mit dem Code: ";
    out.push(
      result(id, `${pfad} (${backup.via} -> buildImportedWallet/saveWallet)`, want, {
        loss: c.loss.concat(d.loss.map((x) => tag + x)),
        ok: [`Backup über ${backup.via}`].concat(c.ok, d.ok.map((x) => tag + x)),
      }),
    );
  }
  return out;
}

// --- runner -----------------------------------------------------------------

async function runScenarios({ oldRoot, newRoot }) {
  if (!oldRoot || !newRoot) throw new Error("runScenarios: oldRoot and newRoot are required");
  const stray = [];
  const onRejection = (e) => stray.push(String((e && e.message) || e));
  const onException = (e) => stray.push(String((e && e.message) || e));
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  const results = [];
  const guard = async (id, fn) => {
    try {
      const r = await fn();
      for (const x of [].concat(r)) results.push(x);
    } catch (e) {
      // A crashed scenario measured nothing: FEHLER fails the check (exitCode),
      // it must never pass as a HINWEIS.
      results.push({ id, pfad: "-", erwartung: "-", beobachtet: `Szenario wirft: ${String((e && e.message) || e)}`, klasse: "FEHLER" });
    }
  };
  try {
    await guard("S1", () => s1(oldRoot, newRoot));
    await guard("S2a", () => s2(oldRoot, newRoot, true));
    await guard("S2b", () => s2(oldRoot, newRoot, false));
    await guard("S3", () => s3(oldRoot, newRoot));
    await guard("S4", () => s4(oldRoot, newRoot));
    await guard("S5", () => s5(oldRoot, newRoot));
    await guard("S6", () => s6(oldRoot, newRoot));
    await guard("S7", () => s7(oldRoot, newRoot));
    await guard("S8", () => s8(oldRoot, newRoot));
    await settle();
  } finally {
    process.removeListener("unhandledRejection", onRejection);
    process.removeListener("uncaughtException", onException);
  }
  if (stray.length) {
    results.push({
      id: "async",
      pfad: "Fehler außerhalb eines Szenarios (Promise/Timer)",
      erwartung: "keine",
      beobachtet: Array.from(new Set(stray)).join(" / "),
      klasse: "HINWEIS",
    });
  }
  return results;
}

// 1 when a scenario lost data or could not run at all, else 0.
function exitCode(results) {
  return results.some((r) => r.klasse === "DATENVERLUST" || r.klasse === "FEHLER") ? 1 : 0;
}

module.exports = { runScenarios, exitCode, appShell, T0 };
