(function () {
  const STORAGE_PREFIX = "db-wallet:";
  const REGISTRY_KEY = "db-wallet:registry";
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

  async function gzipDecompress(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream not available");
    }
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
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
    return obj && typeof obj === "object" ? obj : {};
  }

  function saveRegistry(reg) {
    safeLocalStorageSetItem(REGISTRY_KEY, JSON.stringify(reg));
  }

  window.dbWalletHelpers = {
    STORAGE_PREFIX,
    REGISTRY_KEY,
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
  };
})();
