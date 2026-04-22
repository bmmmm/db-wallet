(function () {
  const helpers = window.dbWalletHelpers || null;
  if (!helpers) return;

  const {
    randomWalletId,
    parseCompactEventId,
    hash53,
    extractLegacyDeviceKey,
  } = helpers;

  function walletNeedsMigration(wallet) {
    if (!wallet || typeof wallet !== "object") return false;
    const v = typeof wallet.v === "number" ? wallet.v : 1;
    if (v < 2) return true;
    const events = Array.isArray(wallet.events) ? wallet.events : [];
    return events.some((e) => {
      const id = e && typeof e.id === "string" ? e.id : "";
      return !!id && !parseCompactEventId(id);
    });
  }

  function migrateWalletV1toV2(wallet) {
    if (!wallet || typeof wallet !== "object") return wallet;

    if (!Array.isArray(wallet.events)) wallet.events = [];
    if (!wallet.walletId) wallet.walletId = randomWalletId();
    if (!wallet.seq || typeof wallet.seq !== "object") wallet.seq = {};

    const usedIds = new Set();
    for (const e of wallet.events) {
      if (e && typeof e.id === "string" && e.id) usedIds.add(e.id);
    }

    for (const e of wallet.events) {
      if (!e || typeof e !== "object") continue;

      const id = typeof e.id === "string" ? e.id : "";
      const oid = typeof e.oid === "string" ? e.oid : "";
      if (id && parseCompactEventId(id) && !oid) continue;

      const legacyId = oid || id || `legacy-${Date.now().toString(36)}`;
      const legacyDevice = extractLegacyDeviceKey(legacyId);

      let seq = hash53(legacyId);
      let newId = `${legacyDevice}.${seq.toString(36)}`;
      while (usedIds.has(newId)) {
        seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
        if (seq <= 0) seq = 1;
        newId = `${legacyDevice}.${seq.toString(36)}`;
      }
      usedIds.add(newId);

      if (!e.oid) e.oid = legacyId;
      e.id = newId;
    }

    const currentV = typeof wallet.v === "number" ? wallet.v : 1;
    wallet.v = Math.max(currentV, 2);
    return wallet;
  }

  window.dbWalletMigrateV1toV2 = migrateWalletV1toV2;
  window.dbWalletNeedsMigration = walletNeedsMigration;
})();
