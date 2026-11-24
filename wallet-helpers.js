(function () {
  const STORAGE_PREFIX = "db-wallet:";
  const REGISTRY_KEY = "db-wallet:registry";
  // Canonical device-symbol set. The import/export codec maps a symbol to its
  // INDEX in this list, so every module must share this one array — a divergent
  // copy would silently mis-encode device symbols across a sync.
  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];
  // Hard ceiling for any single event / action-code amount — far above any real
  // drink count. The one definition shared by storage normalization, the codec
  // and every input path; above it the codec's varint writer would throw and
  // brick every export.
  const MAX_EVENT_AMOUNT = 1000000000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function randomId(len = 6) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function randomToken(len = 18) {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    try {
      if (
        typeof crypto !== "undefined" &&
        crypto &&
        typeof crypto.getRandomValues === "function"
      ) {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
          out += chars[bytes[i] % chars.length];
        }
        return out;
      }
    } catch (e) {
      // ignore
    }

    let out = "";
    for (let i = 0; i < len; i++) {
      out += chars[(Math.random() * chars.length) | 0];
    }
    return out;
  }

  function base64UrlFromBinary(binary) {
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function randomWalletId(bytesLen = 12) {
    const bytes = new Uint8Array(bytesLen);
    if (typeof crypto !== "undefined" && crypto && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return base64UrlFromBinary(binary);
  }

  function base64UrlEncode(str) {
    const bytes = encoder.encode(str);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return base64UrlFromBinary(binary);
  }

  function base64UrlEncodeBytes(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return base64UrlFromBinary(binary);
  }

  function base64UrlDecode(str) {
    const padLen = (4 - (str.length % 4)) % 4;
    const padded = str + "=".repeat(padLen);
    const base = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decoder.decode(bytes);
  }

  function base64UrlDecodeBytes(str) {
    const padLen = (4 - (str.length % 4)) % 4;
    const padded = str + "=".repeat(padLen);
    const base = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function gzipCompress(bytes) {
    if (typeof CompressionStream === "undefined") {
      throw new Error("CompressionStream not available");
    }
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function gzipDecompress(bytes, maxBytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream not available");
    }
    // Cap the decompressed size so a tiny crafted payload cannot inflate into a
    // multi-megabyte buffer and hang/crash the tab (decompression bomb).
    const limit =
      typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : 2 * 1024 * 1024;
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > limit) {
            try {
              await reader.cancel();
            } catch (e) {
              // ignore
            }
            throw new Error("Decompressed payload too large");
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // ignore
      }
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function safeLocalStorageGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeLocalStorageSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeLocalStorageRemoveItem(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadRegistry() {
    const raw = safeLocalStorageGetItem(REGISTRY_KEY);
    const obj = safeParse(raw);
    // null-prototype: a wallet userId is bracket-assigned as a registry key, so a
    // "__proto__" key (e.g. via JSON.parse own-property) must land as an ordinary
    // own property instead of mutating the prototype. JSON.stringify still
    // serializes own enumerable keys, so saveRegistry round-trips cleanly.
    const reg = Object.create(null);
    if (obj && typeof obj === "object") Object.assign(reg, obj);
    return reg;
  }

  function saveRegistry(reg) {
    safeLocalStorageSetItem(REGISTRY_KEY, JSON.stringify(reg));
  }

  function parseCompactEventId(id) {
    if (!id || typeof id !== "string") return null;
    const m = id.match(/^([A-Za-z0-9_-]+)\.([0-9a-z]+)$/);
    if (!m) return null;
    const deviceKey = m[1];
    const seq = parseInt(m[2], 36);
    if (!deviceKey || isNaN(seq) || seq <= 0 || seq > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return { deviceKey, seq };
  }

  // Inverse of parseCompactEventId.
  function formatCompactEventId(deviceKey, seq) {
    return `${deviceKey}.${seq.toString(36)}`;
  }

  function cmpStr(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  // Canonical tie-break for equal-timestamp events. Event ids are
  // `deviceKey.<seq-base36>`; compare the deviceKey lexically but the sequence
  // numerically — a plain lexical compare inverts order at every base36 width
  // boundary (seq 36 = "10" sorts before seq 35 = "z"). Single source of truth:
  // summary/storage/import-v2 all defer here so their orderings can't diverge.
  function cmpEventId(a, b) {
    const idA = typeof a === "string" ? a : "";
    const idB = typeof b === "string" ? b : "";
    if (idA === idB) return 0;
    const pa = parseCompactEventId(idA);
    const pb = parseCompactEventId(idB);
    if (pa && pb) {
      if (pa.deviceKey !== pb.deviceKey) return cmpStr(pa.deviceKey, pb.deviceKey);
      return pa.seq - pb.seq;
    }
    return cmpStr(idA, idB);
  }

  function eventMinute(e) {
    const ts = e && typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : 0;
    return Math.floor(ts / 60000);
  }

  // The chain root of an event: an edit replacement carries supersedes=<root>,
  // an un-edited event is its own root (dbWalletSummary.rootIdOf is this).
  function eventRootId(e) {
    if (e && typeof e.supersedes === "string" && e.supersedes) return e.supersedes;
    return e && typeof e.id === "string" ? e.id : "";
  }

  // Canonical full-event comparator (P5.4), the same on every device: the
  // minute, then the entry's root id, then the event's own id. The QR export
  // keeps only the minute (an imported event's sub-minute time is its payload
  // position), so milliseconds must not decide the order — within a minute the
  // ids do: on one device the seq is the booking order, between devices the
  // deviceKey decides. Sorting by the root id keeps an edit that kept its ts at
  // the original's place (before a later pay of that minute). Used wherever an
  // event list is sorted before folding the balance, and by the encoder.
  function compareEventsByTime(a, b) {
    const aMin = eventMinute(a);
    const bMin = eventMinute(b);
    if (aMin !== bMin) return aMin - bMin;
    const byRoot = cmpEventId(eventRootId(a), eventRootId(b));
    if (byRoot !== 0) return byRoot;
    const aId = a && typeof a.id === "string" ? a.id : "";
    const bId = b && typeof b.id === "string" ? b.id : "";
    return cmpEventId(aId, bId);
  }

  // Seq values from 2^40 up are not a booking count (a crafted import); an
  // edit does not lift its device counter above them (newEvent).
  const EDIT_SEQ_LIMIT = 2 ** 40;

  // The edit order of one id: its parsed compact id, or null for a migrated
  // event (`oid`, its seq is a hash of the v1 id) or a non-compact id.
  function editOrderOf(e) {
    if (!e || (typeof e.oid === "string" && e.oid)) return null;
    return parseCompactEventId(typeof e.id === "string" ? e.id : "");
  }

  // Which replacement of one entry is the later edit (> 0: a). Not by time —
  // an edit may move an entry further back: the higher seq wins, a tie the
  // larger deviceKey. newEvent lifts an edit's seq above every replacement of
  // the entry the device has seen, so an edit beats what it replaced, on every
  // device; concurrent edits converge on one winner. Migrated and non-compact
  // ids rank below, among themselves in canonical order.
  function compareEdits(a, b) {
    const pa = editOrderOf(a);
    const pb = editOrderOf(b);
    if (pa && pb) {
      if (pa.seq !== pb.seq) return pa.seq - pb.seq;
      return cmpStr(pa.deviceKey, pb.deviceKey);
    }
    if (pa) return 1;
    if (pb) return -1;
    return compareEventsByTime(a, b);
  }

  function fnv1a64(bytes) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (const b of bytes) {
      hash ^= BigInt(b);
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash;
  }

  function hash53(str) {
    const bytes = encoder.encode(String(str || ""));
    const h64 = fnv1a64(bytes);
    const mask = (1n << 53n) - 1n;
    const h53 = Number(h64 & mask);
    return h53 > 0 ? h53 : 1;
  }

  function extractLegacyDeviceKey(id) {
    if (!id || typeof id !== "string") return "legacy";
    const idx = id.indexOf("-");
    if (idx <= 0) return "legacy";
    const raw = id.slice(0, idx);
    const cleaned = raw.replace(/[^a-z0-9_-]/gi, "").slice(0, 16);
    return cleaned || "legacy";
  }

  function formatDate(tsMs) {
    if (typeof tsMs !== "number" || !Number.isFinite(tsMs) || tsMs <= 0) {
      return "";
    }
    const d = new Date(tsMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateTime(tsMs) {
    const datePart = formatDate(tsMs);
    if (!datePart) return "";
    const d = new Date(tsMs);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${datePart} ${hh}:${mm}`;
  }

  // Hash prefixes the router reads as an action or an import — never a user
  // id. The one list (hash-router.js and wallet-storage.js use it).
  const RESERVED_HASH_PREFIXES = Object.freeze(["ac:", "acg:", "import:", "i2u:", "i2:"]);

  function isReservedHashPrefix(raw) {
    const s = String(raw || "");
    return RESERVED_HASH_PREFIXES.some((p) => s.startsWith(p));
  }

  // German letters spelled out (P4.5: "Jörg" became "jrg"); other accents
  // lose their mark below ("é" → "e").
  const TRANSLITERATE = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

  // Sanitizes a raw user-supplied string into a safe user id: lowercase,
  // umlauts transliterated and accents dropped, spaces collapsed to hyphens,
  // anything outside [a-z0-9_-] stripped, capped at 64 chars. Returns "" if
  // nothing usable remains (caller decides the fallback — e.g. generating a
  // random id).
  function normalizeUserId(raw) {
    let s = String(raw || "")
      .trim()
      .toLowerCase()
      // NFC first, so a decomposed "o" + U+0308 is the "ö" the table knows.
      .normalize("NFC")
      .replace(/[äöüß]/g, (c) => TRANSLITERATE[c]);
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 64);
  }

  // Replace the URL fragment in place (history.replaceState): no new session
  // history entry and no "hashchange". Assigning location.hash would push an
  // entry (Back re-runs an #ac: booking) and fire a second hashchange that
  // re-enters the router. An empty target drops the fragment. Returns false
  // when replaceState is unavailable, so callers can fall back.
  function replaceHashSilently(nextHash) {
    const target = String(nextHash || "").trim().replace(/^#/, "");
    const current = String(window.location.hash || "").slice(1);
    if (current === target) return true;
    if (window.history && typeof window.history.replaceState === "function") {
      try {
        const base = String(window.location.href || "").split("#")[0];
        window.history.replaceState(null, "", target ? base + "#" + target : base);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  // qrcodegen.js (35 KB) is loaded on first use (P5.6), not by the page: only
  // the export QR and an open action-code panel need it. Resolves with
  // window.qrcodegen; a failed load rejects with "QR library missing" and a
  // later call tries again. The file stays in the SW precache (offline).
  const QR_LIBRARY_SRC = "qrcodegen.js";
  let qrLibraryLoading = null;

  function qrLibrary() {
    const lib = window.qrcodegen;
    return lib && lib.QrCode ? lib : null;
  }

  function loadQrLibrary() {
    const ready = qrLibrary();
    if (ready) return Promise.resolve(ready);
    if (qrLibraryLoading) return qrLibraryLoading;
    const missing = () => new Error("QR library missing");
    if (typeof document === "undefined" || !document || typeof document.createElement !== "function") {
      return Promise.reject(missing());
    }
    qrLibraryLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = QR_LIBRARY_SRC;
      script.onload = () => {
        const lib = qrLibrary();
        if (lib) resolve(lib);
        else reject(missing());
      };
      script.onerror = () => reject(missing());
      (document.head || document.body).appendChild(script);
    }).catch((err) => {
      qrLibraryLoading = null;
      throw err;
    });
    return qrLibraryLoading;
  }

  // Renders a QR code for `text` onto `canvas` using the global qrcodegen
  // library. opts: { scale, maxPx, border }. `scale` is a fixed pixel-per-module
  // integer; if omitted and `maxPx` is given, scale is derived to fit within
  // maxPx. `border` defaults to 4 modules. Throws if the QR library is missing
  // or encodeText fails — callers are expected to catch.
  // Returns the QrCode (also without a 2d context); undefined without a canvas.
  function drawQrToCanvas(canvas, text, opts) {
    if (!canvas) return;
    if (!window.qrcodegen || !window.qrcodegen.QrCode) {
      throw new Error("QR library missing");
    }
    const o = opts || {};
    const border = typeof o.border === "number" ? o.border : 4;
    const ecc = window.qrcodegen.QrCode.Ecc.LOW;
    const qr = window.qrcodegen.QrCode.encodeText(String(text || ""), ecc);
    const size = qr.size;
    const modules = size + border * 2;
    let scale = typeof o.scale === "number" ? o.scale : 0;
    if (!scale && typeof o.maxPx === "number") {
      scale = Math.max(2, Math.floor(o.maxPx / modules));
    }
    if (!scale) scale = 2;
    const dim = modules * scale;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d");
    if (!ctx) return qr;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.getModule(x, y)) {
          ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  // Object URLs of a download stay valid this long. Revoking right after
  // click() can cancel the download in Safari (the click only schedules it);
  // FileSaver.js waits 40 s for the same reason.
  const BLOB_URL_REVOKE_MS = 40000;

  // Saves `blob` as `filename` via a temporary <a download>. The single path
  // for every Blob download (JSON backup, export QR PNG, action-code QR PNG).
  function downloadBlob(blob, filename) {
    if (!blob || typeof URL === "undefined" || !URL.createObjectURL) return false;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(href);
      } catch (e) {
        // ignore
      }
    }, BLOB_URL_REVOKE_MS);
    return true;
  }

  // A JSON file download (wallet backups), pretty-printed. Goes through the
  // namespace's downloadBlob, so a stub of it (tests) sees this download too.
  function downloadJson(data, filename) {
    if (typeof Blob === "undefined") return false;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const api = window.dbWalletHelpers;
    const save = api && typeof api.downloadBlob === "function" ? api.downloadBlob : downloadBlob;
    return save(blob, filename);
  }

  // --- Status line (P4.1) ----------------------------------------------------
  // One line per page (#status-line; #status-text is the role="status" live
  // region) takes the success and error notices that used to be alert()s.
  // opts: kind "ok" | "error", action { label, run } (one button), sticky
  // (stays until the next notice or ×). Others clear themselves after a while,
  // errors later than successes. Without the line (a page that has none) the
  // notice falls back to alert(); a notice right before leaving the page must
  // call alert() itself, the line would vanish with the page.
  const STATUS_CLEAR_MS = { ok: 6000, action: 10000, error: 15000 };
  let statusTimer = null;
  let statusAction = null;

  function statusRefs() {
    if (typeof document === "undefined" || !document || typeof document.getElementById !== "function") {
      return null;
    }
    const line = document.getElementById("status-line");
    const text = document.getElementById("status-text");
    if (!line || !text) return null;
    const refs = {
      line,
      text,
      action: document.getElementById("status-action"),
      close: document.getElementById("status-close"),
    };
    if (!line.dataset.statusBound) {
      line.dataset.statusBound = "1";
      if (refs.action) {
        refs.action.addEventListener("click", () => {
          const action = statusAction;
          clearStatus();
          if (action) action.run();
        });
      }
      if (refs.close) refs.close.addEventListener("click", () => clearStatus());
    }
    return refs;
  }

  function clearStatus() {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    statusAction = null;
    const refs = statusRefs();
    if (!refs) return;
    refs.text.textContent = "";
    refs.line.classList.remove("is-visible");
    refs.line.classList.remove("is-error");
    if (refs.action) {
      refs.action.textContent = "";
      refs.action.hidden = true;
    }
    if (refs.close) refs.close.hidden = true;
  }

  // The line is fixed at the bottom of the viewport; an error usually puts
  // the focus on the field it is about, which on a small phone may sit right
  // behind the line. Scroll that element clear of it (WCAG 2.4.11).
  function keepFocusClearOf(line) {
    try {
      const el = typeof document !== "undefined" ? document.activeElement : null;
      if (!el || el === document.body || typeof el.getBoundingClientRect !== "function") return;
      if (typeof line.getBoundingClientRect !== "function" || typeof window.scrollBy !== "function") return;
      const lineTop = line.getBoundingClientRect().top;
      const r = el.getBoundingClientRect();
      if (!(lineTop > 0) || r.bottom <= lineTop || r.top >= window.innerHeight) return;
      window.scrollBy(0, Math.ceil(r.bottom - lineTop + 12));
    } catch (e) {
      // ignore — no layout (tests) or an exotic element
    }
  }

  function notify(message, opts) {
    const text = String(message == null ? "" : message).trim();
    if (!text) return false;
    const o = opts || {};
    const refs = statusRefs();
    if (!refs) {
      if (typeof alert === "function") alert(text);
      return false;
    }
    const isError = o.kind === "error";
    const action =
      o.action && typeof o.action.run === "function" && o.action.label ? o.action : null;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    statusAction = action;
    refs.text.textContent = text;
    refs.line.classList.add("is-visible");
    refs.line.classList.toggle("is-error", isError);
    if (refs.action) {
      refs.action.textContent = action ? String(action.label) : "";
      refs.action.hidden = !action;
    }
    if (refs.close) refs.close.hidden = false;
    keepFocusClearOf(refs.line);
    if (!o.sticky) {
      const ms = isError ? STATUS_CLEAR_MS.error : action ? STATUS_CLEAR_MS.action : STATUS_CLEAR_MS.ok;
      statusTimer = setTimeout(clearStatus, ms);
    }
    return true;
  }

  // P4.3: the one confirmation dialog (#confirm-dialog on wallet.html) —
  // resolves true for the OK button, false for Abbrechen or Escape (the
  // browser's "cancel", then "close"). The focus goes back to where it was.
  // Without the dialog (or without showModal) it asks window.confirm.
  // opts: okLabel (default "OK"), cancelLabel ("Abbrechen"), danger (red OK,
  // the focus starts on Abbrechen), extra {label, run} (P4.5: a third button,
  // #confirm-extra, that runs `run` and keeps the question open — e.g. "save
  // a backup first"; a string returned by `run` becomes its new label).
  let confirmPending = null;

  function confirmDialog(message, opts) {
    const text = String(message == null ? "" : message);
    const o = opts || {};
    const dlg = typeof document !== "undefined" && document.getElementById
      ? document.getElementById("confirm-dialog")
      : null;
    const textEl = dlg ? document.getElementById("confirm-text") : null;
    const ok = dlg ? document.getElementById("confirm-ok") : null;
    const cancel = dlg ? document.getElementById("confirm-cancel") : null;
    const extraBtn = dlg ? document.getElementById("confirm-extra") : null;
    if (!dlg || typeof dlg.showModal !== "function" || !textEl || !ok || !cancel) {
      return Promise.resolve(typeof confirm === "function" ? !!confirm(text) : false);
    }
    // A second question while one is open: the first one counts as declined.
    if (confirmPending) confirmPending(false);
    const opener = document.activeElement || null;
    textEl.textContent = text;
    ok.textContent = o.okLabel ? String(o.okLabel) : "OK";
    cancel.textContent = o.cancelLabel ? String(o.cancelLabel) : "Abbrechen";
    dlg.classList.toggle("is-danger", !!o.danger);
    const extra =
      extraBtn && o.extra && typeof o.extra.run === "function" ? o.extra : null;
    if (extraBtn) {
      extraBtn.hidden = !extra;
      extraBtn.textContent = extra ? String(extra.label || "") : "";
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        confirmPending = null;
        ok.removeEventListener("click", onOk);
        cancel.removeEventListener("click", onCancel);
        if (extraBtn) {
          extraBtn.removeEventListener("click", onExtra);
          extraBtn.hidden = true;
        }
        dlg.removeEventListener("close", onClose);
        if (dlg.open) {
          try {
            dlg.close();
          } catch (e) {
            // ignore
          }
        }
        if (opener && typeof opener.focus === "function") {
          try {
            opener.focus();
          } catch (e) {
            // ignore
          }
        }
        resolve(answer);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onExtra = () => {
        let label;
        try {
          label = extra.run();
        } catch (e) {
          label = undefined;
        }
        if (typeof label === "string" && label) extraBtn.textContent = label;
      };
      // dialog.close() queues its "close" event as a task: when a new
      // question already re-opened the dialog, that event is stale.
      const onClose = () => {
        if (!dlg.open) finish(false);
      };
      ok.addEventListener("click", onOk);
      cancel.addEventListener("click", onCancel);
      if (extra) extraBtn.addEventListener("click", onExtra);
      dlg.addEventListener("close", onClose);
      confirmPending = finish;
      dlg.showModal();
      const first = o.danger ? cancel : ok;
      if (typeof first.focus === "function") first.focus();
    });
  }

  // Runs onYes/onNo for an answer that is a boolean or a promise of one (a
  // ctx stub answers at once, the dialog later). Returns what they return,
  // or a promise of it.
  function whenConfirmed(answer, onYes, onNo) {
    const pick = (yes) => (yes ? onYes() : typeof onNo === "function" ? onNo() : undefined);
    if (answer && typeof answer.then === "function") return answer.then(pick);
    return pick(!!answer);
  }

  window.dbWalletHelpers = {
    STORAGE_PREFIX,
    REGISTRY_KEY,
    DEVICE_SYMBOLS,
    MAX_EVENT_AMOUNT,
    randomId,
    randomToken,
    randomWalletId,
    base64UrlEncode,
    base64UrlEncodeBytes,
    base64UrlDecode,
    base64UrlDecodeBytes,
    gzipCompress,
    gzipDecompress,
    loadRegistry,
    saveRegistry,
    safeParse,
    safeLocalStorageGetItem,
    safeLocalStorageSetItem,
    safeLocalStorageRemoveItem,
    parseCompactEventId,
    formatCompactEventId,
    cmpStr,
    cmpEventId,
    eventRootId,
    compareEventsByTime,
    compareEdits,
    editOrderOf,
    EDIT_SEQ_LIMIT,
    fnv1a64,
    hash53,
    extractLegacyDeviceKey,
    formatDate,
    formatDateTime,
    normalizeUserId,
    RESERVED_HASH_PREFIXES,
    isReservedHashPrefix,
    replaceHashSilently,
    drawQrToCanvas,
    loadQrLibrary,
    BLOB_URL_REVOKE_MS,
    downloadBlob,
    downloadJson,
    notify,
    confirmDialog,
    whenConfirmed,
  };
})();
