// Browser smoke test for wallet.html: `await dbWalletSelfCheck.run()` in the
// console (self-check-loader.js loads this file on the first call). It checks
// only what needs a real browser — storage, native gzip, the history API, the
// lazy QR script, the CSS of the page state, the Service Worker. The booking,
// codec and merge logic is tested in Node (`node --test tests/`).
//
// run({quiet}) resolves with {ok, checks, errors}: one {name, ok, info} per
// check; a check whose browser feature is missing here (no Service Worker,
// an http origin, …) is {ok: true, skipped: true, info: reason}. A check that
// throws fails, and its message also lands in `errors`.
// tests/self-check-smoke.test.js runs this file on the Node page fake.
(function () {
  const PROBE_TEXT = "db-wallet self-check";

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // The promise's value, or `fallback` after `ms`.
  function within(promise, ms, fallback) {
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // Shown = neither the element nor an ancestor computes to display: none.
  function displayed(el) {
    if (!el || el.isConnected === false) return false;
    for (let n = el; n && n.nodeType !== 9; n = n.parentNode) {
      if (window.getComputedStyle(n).display === "none") return false;
    }
    return true;
  }

  // A throwaway wallet goes through the real localStorage and is removed
  // again (the item and its registry entry, like the start page's "Löschen").
  // A device key it mints on a fresh browser stays: storage keeps it in memory
  // for this tab too, and the first booking would mint it anyway.
  function checkStorage() {
    const H = window.dbWalletHelpers;
    const S = window.dbWalletStorage;
    const userId = S.ensureNonReservedUserId("selfcheck-" + H.randomId());
    const key = H.STORAGE_PREFIX + userId;
    const hadRegistry = window.localStorage.getItem(H.REGISTRY_KEY) !== null;
    let saved = false;
    let info = "";
    try {
      const wallet = S.loadWallet(userId);
      const events = [S.newEvent(wallet, "d", 2), S.newEvent(wallet, "g", 1)];
      if (!S.appendEvents(wallet, events)) {
        return { ok: false, info: "save failed: " + S.getLastSaveError() };
      }
      const raw = JSON.parse(window.localStorage.getItem(key) || "null");
      const back = S.loadWallet(userId);
      const total = window.dbWalletSummary.computeSummary(back).total;
      saved =
        !!raw &&
        raw.events.length === 2 &&
        back.walletId === wallet.walletId &&
        back.events.length === 2 &&
        total === 2;
      info = `stored ${raw ? raw.events.length : 0} events, loaded ${back.events.length}, total ${total}`;
    } finally {
      H.safeLocalStorageRemoveItem(key);
      const reg = H.loadRegistry();
      delete reg[userId];
      if (!hadRegistry && !Object.keys(reg).length) H.safeLocalStorageRemoveItem(H.REGISTRY_KEY);
      else H.saveRegistry(reg);
    }
    const gone = window.localStorage.getItem(key) === null && !H.loadRegistry()[userId];
    return { ok: saved && gone, info: gone ? info : info + "; not removed: " + key };
  }

  // The i2: export links and their import: the browser's own gzip, with the
  // decompression cap (a tiny payload must not inflate into megabytes).
  async function checkGzip() {
    if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
      return { skip: "no CompressionStream/DecompressionStream" };
    }
    const H = window.dbWalletHelpers;
    const plain = new Uint8Array(5000).fill(65);
    const packed = await H.gzipCompress(plain);
    let capped = "";
    try {
      await H.gzipDecompress(packed, 100);
    } catch (e) {
      capped = String((e && e.message) || e);
    }
    const full = await H.gzipDecompress(packed, 1000000);
    const same = full.length === plain.length && full.every((b) => b === 65);
    return {
      ok: packed.length < plain.length && /too large/.test(capped) && same,
      info: `5000 → ${packed.length} bytes, cap 100: ${capped || "not enforced"}, back ${full.length}`,
    };
  }

  // Consumed #ac:/import links are removed with replaceState: no new history
  // entry (Back would book again) and no hashchange. Restores the hash.
  async function checkSilentHash() {
    const H = window.dbWalletHelpers;
    const before = { hash: window.location.hash, length: window.history.length };
    const probe = "selfcheck-" + H.randomId();
    let fired = 0;
    let moved = false;
    const onChange = () => fired++;
    window.addEventListener("hashchange", onChange);
    try {
      moved = H.replaceHashSilently(probe) && window.location.hash === "#" + probe;
      H.replaceHashSilently(before.hash.slice(1));
      // A hashchange would be dispatched by now.
      await delay(0);
      await delay(0);
    } finally {
      window.removeEventListener("hashchange", onChange);
    }
    const kept = window.history.length === before.length && window.location.hash === before.hash;
    return {
      ok: moved && kept && fired === 0,
      info: `moved ${moved}, history ${before.length} → ${window.history.length}, hashchange ${fired}`,
    };
  }

  // qrcodegen.js is no page script: helpers.loadQrLibrary appends it on first
  // use (P5.6). Then one QR on a canvas.
  async function checkQr() {
    const H = window.dbWalletHelpers;
    const lib = await H.loadQrLibrary();
    const canvas = document.createElement("canvas");
    const qr = H.drawQrToCanvas(canvas, PROBE_TEXT, { maxPx: 200 });
    return {
      ok: !!(lib && lib.QrCode) && !!qr && qr.size > 0 && canvas.width > 0,
      info: `${qr ? qr.size : 0} modules, canvas ${canvas.width} px`,
    };
  }

  // The page state as the CSS shows it: without a wallet only the notice
  // (body[data-no-wallet] hides the rest) with a way out; with a wallet the
  // header, the three stats and the booking button.
  function checkPageState() {
    if (typeof window.getComputedStyle !== "function") return { skip: "no getComputedStyle" };
    // wallet-ui.js sets dbWalletUi up only once a wallet opens.
    const ui = window.dbWalletUi;
    const userId = ui ? ui.getCurrentUserId() : "";
    const notice = document.getElementById("global-action-message");
    const header = document.getElementById("wallet-header");
    const problems = [];
    let state;
    if (document.body.dataset.noWallet === "1") {
      const choice = document.getElementById("global-action-wallet-select");
      state = choice ? "acg wallet choice" : "no wallet";
      if (!displayed(notice)) problems.push("notice hidden");
      if (displayed(header)) problems.push("wallet header shown");
      if (userId) problems.push("wallet open: " + userId);
      if (choice) {
        if (!displayed(choice)) problems.push("wallet choice hidden");
      } else {
        const links = notice ? Array.from(notice.querySelectorAll("a")) : [];
        const home = links.some((a) => /(^|\/)index\.html$/.test(String(a.getAttribute("href") || a.href || "")));
        if (!home) problems.push("no link to the start page");
      }
    } else {
      state = "wallet " + (userId || "(none)");
      if (!userId) problems.push("no wallet open");
      const shownId = document.getElementById("uid").textContent;
      if (shownId !== userId) problems.push(`#uid shows "${shownId}"`);
      for (const id of ["wallet-header", "total", "unpaid", "credit", "btn-drink"]) {
        if (!displayed(document.getElementById(id))) problems.push("#" + id + " hidden");
      }
      if (notice && notice.dataset.mode === "no-wallet" && displayed(notice)) {
        problems.push("no-wallet notice shown");
      }
    }
    return { ok: !problems.length, info: problems.length ? state + ": " + problems.join(", ") : state };
  }

  // sw-register.js registers only where a Service Worker may run (the same
  // condition here); the page must end up with an active one.
  async function checkServiceWorker() {
    const sw = window.navigator && window.navigator.serviceWorker;
    if (!sw) return { skip: "no navigator.serviceWorker" };
    const host = window.location.hostname;
    if (window.location.protocol !== "https:" && host !== "localhost" && host !== "127.0.0.1") {
      return { skip: "not registered on " + window.location.protocol + "//" + host };
    }
    const reg = await within(sw.ready, 3000, null);
    if (!reg) return { ok: false, info: "no active Service Worker after 3 s" };
    return { ok: true, info: reg.scope + (sw.controller ? "" : " (page not controlled yet: first visit)") };
  }

  // Offline needs every file of the page in the precache (APP_SHELL), also the
  // two loaded on demand: self-check.js itself and qrcodegen.js.
  async function checkServiceWorkerCache() {
    if (typeof caches === "undefined" || !caches) return { skip: "no Cache Storage" };
    if (!(await caches.keys()).length) return { skip: "nothing cached yet (first visit or no Service Worker)" };
    const origin = window.location.origin;
    const own = (url) => !!url && url.startsWith(origin + "/");
    const urls = new Set([origin + window.location.pathname]);
    for (const s of Array.from(document.scripts)) if (own(s.src)) urls.add(s.src);
    for (const l of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
      if (own(l.href)) urls.add(l.href);
    }
    for (const f of ["self-check.js", "qrcodegen.js"]) urls.add(new URL(f, window.location.href).href);
    const missing = [];
    for (const url of urls) if (!(await caches.match(url))) missing.push(url.slice(origin.length));
    return {
      ok: !missing.length,
      info: missing.length ? "missing: " + missing.join(", ") : urls.size + " files cached",
    };
  }

  const CHECKS = [
    ["page state matches the CSS", checkPageState],
    ["localStorage round trip, removed again", checkStorage],
    ["native gzip with size cap", checkGzip],
    ["replaceHashSilently adds no history entry", checkSilentHash],
    ["QR library loads on demand and draws", checkQr],
    ["Service Worker active", checkServiceWorker],
    ["Service Worker cache covers the page", checkServiceWorkerCache],
  ];

  async function check(result, name, fn) {
    let entry;
    try {
      const r = (await fn()) || {};
      entry = r.skip
        ? { name, ok: true, skipped: true, info: r.skip }
        : { name, ok: !!r.ok, info: r.info || "" };
    } catch (e) {
      const msg = String((e && e.message) || e);
      entry = { name, ok: false, info: "threw: " + msg };
      result.errors.push(name + ": " + msg);
    }
    result.checks.push(entry);
    if (!entry.ok) result.ok = false;
  }

  async function run(options) {
    const result = { ok: true, checks: [], errors: [] };
    for (const [name, fn] of CHECKS) await check(result, name, fn);
    if (!(options && options.quiet)) {
      const failed = result.checks.filter((c) => !c.ok).length;
      const skipped = result.checks.filter((c) => c.skipped).length;
      console.log(
        `db-wallet self-check: ${result.checks.length - failed}/${result.checks.length} ok` +
          (skipped ? `, ${skipped} skipped` : ""),
        result,
      );
    }
    return result;
  }

  window.dbWalletSelfCheck = { run };
})();
