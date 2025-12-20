(function () {
  // Hash formats are part of the external contract: ac:, acg:, import:, i2:, i2u:
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

  function normalizeUserId(input) {
    let n = String(input || "")
      .trim()
      .toLowerCase();
    n = n.replace(/\s+/g, "-");
    n = n.replace(/[^a-z0-9_-]/g, "");
    return n;
  }

  function isReservedHashPrefix(raw) {
    return (
      raw.startsWith("ac:") ||
      raw.startsWith("acg:") ||
      raw.startsWith("import:") ||
      raw.startsWith("i2:") ||
      raw.startsWith("i2u:")
    );
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

    const normalized = normalizeUserId(value);
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
        const payload = helpers.base64UrlDecode(raw.slice(7));
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
        const bytes = helpers.base64UrlDecodeBytes(raw.slice(4));
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
        const bytes = helpers.base64UrlDecodeBytes(raw.slice(3));
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
  };
})();
