(function () {
  const STORAGE_PREFIX = "db-wallet:";
  const REGISTRY_KEY = "db-wallet:registry";
  // Canonical device-symbol set. The import/export codec maps a symbol to its
  // INDEX in this list, so every module must share this one array — a divergent
  // copy would silently mis-encode device symbols across a sync.
  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];
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

  // Canonical full-event comparator: primary key timestamp, tie-broken by
  // cmpEventId. Used wherever an event list is sorted before folding the balance.
  function compareEventsByTime(a, b) {
    const aTs = a && typeof a.ts === "number" && Number.isFinite(a.ts) ? a.ts : 0;
    const bTs = b && typeof b.ts === "number" && Number.isFinite(b.ts) ? b.ts : 0;
    if (aTs !== bTs) return aTs - bTs;
    const aId = a && typeof a.id === "string" ? a.id : "";
    const bId = b && typeof b.id === "string" ? b.id : "";
    return cmpEventId(aId, bId);
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

  // Sanitizes a raw user-supplied string into a safe user id: lowercase,
  // spaces collapsed to hyphens, anything outside [a-z0-9_-] stripped, capped
  // at 64 chars. Returns "" if nothing usable remains (caller decides the
  // fallback — e.g. generating a random id).
  function normalizeUserId(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 64);
  }

  // Renders a QR code for `text` onto `canvas` using the global qrcodegen
  // library. opts: { scale, maxPx, border }. `scale` is a fixed pixel-per-module
  // integer; if omitted and `maxPx` is given, scale is derived to fit within
  // maxPx. `border` defaults to 4 modules. Throws if the QR library is missing
  // or encodeText fails — callers are expected to catch.
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
    if (!ctx) return;
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
  }

  window.dbWalletHelpers = {
    STORAGE_PREFIX,
    REGISTRY_KEY,
    DEVICE_SYMBOLS,
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
    compareEventsByTime,
    fnv1a64,
    hash53,
    extractLegacyDeviceKey,
    formatDate,
    formatDateTime,
    normalizeUserId,
    drawQrToCanvas,
  };
})();
