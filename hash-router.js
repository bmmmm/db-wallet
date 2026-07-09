(function () {
  const RESERVED_PREFIXES = ["ac:", "acg:", "import:", "i2u:", "i2:"];
  // Guard against a multi-MB hash freezing the tab during DOMContentLoaded;
  // the real per-format cap enforcement lives in wallet-import-v2.js.
  const MAX_HASH_PAYLOAD_LEN = 3 * 1024 * 1024;

  function getHashKind(hash) {
    const raw = String(hash || "");
    if (!raw) return "";
    if (raw.startsWith("ac:")) return "action";
    if (raw.startsWith("acg:")) return "action-global";
    if (raw.startsWith("import:")) return "import";
    if (raw.startsWith("i2u:")) return "import-v2-plain";
    if (raw.startsWith("i2:")) return "import-v2";
    return "";
  }

  function isReservedHashPrefix(raw) {
    const s = String(raw || "");
    for (const p of RESERVED_PREFIXES) {
      if (s.startsWith(p)) return true;
    }
    return false;
  }

  function isValidUserId(raw) {
    const value = String(raw || "").trim();
    if (!value) return false;
    if (isReservedHashPrefix(value)) return false;

    const storage = window.dbWalletStorage || null;
    if (
      storage &&
      typeof storage.userIdExists === "function" &&
      storage.userIdExists(value)
    ) {
      return true;
    }

    let normalized = value.toLowerCase();
    normalized = normalized.replace(/\s+/g, "-");
    normalized = normalized.replace(/[^a-z0-9_-]/g, "");
    return !!normalized && normalized === value;
  }

  function classifyHash(hash) {
    const raw = String(hash || "");
    if (!raw) return { kind: "none" };
    if (raw.startsWith("acg:")) return { kind: "globalAction", raw };
    if (raw.startsWith("ac:")) return { kind: "localAction", raw };
    if (
      raw.startsWith("import:") ||
      raw.startsWith("i2:") ||
      raw.startsWith("i2u:")
    ) {
      return { kind: "import", raw };
    }
    const trimmed = raw.trim();
    if (!trimmed) return { kind: "none" };
    if (!isValidUserId(trimmed)) return { kind: "none" };
    return { kind: "user", userId: trimmed };
  }

  async function parseWalletIdFromHash(hash) {
    const raw = String(hash || "");
    const kind = getHashKind(raw);
    if (!kind) return "";

    const helpers = window.dbWalletHelpers || null;
    const importV2 = window.dbWalletImportV2 || null;

    try {
      if (kind === "action") {
        const actionApi = window.dbWalletActionCodes || null;
        const decoded =
          actionApi && typeof actionApi.decodeActionHash === "function"
            ? actionApi.decodeActionHash(raw)
            : null;
        return decoded && typeof decoded.walletId === "string"
          ? decoded.walletId
          : "";
      }
      if (kind === "action-global") {
        return "";
      }

      if (kind === "import") {
        if (!helpers || typeof helpers.base64UrlDecode !== "function")
          return "";
        const encoded = raw.slice(7);
        if (encoded.length > MAX_HASH_PAYLOAD_LEN) return "";
        const payload = helpers.base64UrlDecode(encoded);
        const remote =
          helpers && typeof helpers.safeParse === "function"
            ? helpers.safeParse(payload)
            : null;
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }

      if (kind === "import-v2-plain") {
        if (
          !helpers ||
          typeof helpers.base64UrlDecodeBytes !== "function" ||
          !importV2 ||
          typeof importV2.decodeImportV2Bytes !== "function"
        ) {
          return "";
        }
        const encoded = raw.slice(4);
        if (encoded.length > MAX_HASH_PAYLOAD_LEN) return "";
        const bytes = helpers.base64UrlDecodeBytes(encoded);
        const remote = importV2.decodeImportV2Bytes(bytes);
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }

      if (kind === "import-v2") {
        if (
          !helpers ||
          typeof helpers.base64UrlDecodeBytes !== "function" ||
          typeof helpers.gzipDecompress !== "function" ||
          !importV2 ||
          typeof importV2.decodeImportV2Bytes !== "function"
        ) {
          return "";
        }
        const encoded = raw.slice(3);
        if (encoded.length > MAX_HASH_PAYLOAD_LEN) return "";
        const bytes = helpers.base64UrlDecodeBytes(encoded);
        const decompressed = await helpers.gzipDecompress(bytes);
        const remote = importV2.decodeImportV2Bytes(decompressed);
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }
    } catch (e) {
      return "";
    }

    return "";
  }

  window.dbWalletHashRouter = {
    classifyHash,
    getHashKind,
    parseWalletIdFromHash,
    isReservedHashPrefix,
  };
})();
