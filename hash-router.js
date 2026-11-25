(function () {
  const helpers = window.dbWalletHelpers || null;
  if (
    !helpers ||
    typeof helpers.isReservedHashPrefix !== "function" ||
    typeof helpers.normalizeUserId !== "function"
  ) {
    return;
  }
  const { isReservedHashPrefix, normalizeUserId } = helpers;

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

    // A typed id is valid only in its normalized form (the same rule, and the
    // same 64-char cap, as creating a wallet).
    const normalized = normalizeUserId(value);
    return !!normalized && normalized === value;
  }

  function classifyHash(hash) {
    const raw = String(hash || "");
    if (!raw) return { kind: "none" };
    if (raw.startsWith("acg:")) return { kind: "globalAction", raw };
    if (raw.startsWith("ac:")) return { kind: "localAction", raw };
    // Every other reserved prefix is an import (import:, i2:, i2u:).
    if (isReservedHashPrefix(raw)) return { kind: "import", raw };
    const trimmed = raw.trim();
    if (!trimmed) return { kind: "none" };
    if (!isValidUserId(trimmed)) return { kind: "none" };
    return { kind: "user", userId: trimmed };
  }

  window.dbWalletHashRouter = {
    classifyHash,
  };
})();
