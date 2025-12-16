(function () {
  const encoder = new TextEncoder();

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
