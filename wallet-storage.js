(function () {
  const helpers = window.dbWalletHelpers || null;
  if (!helpers) return;

  const {
    STORAGE_PREFIX,
    REGISTRY_KEY,
    randomId,
    randomWalletId,
    loadRegistry,
    saveRegistry,
    safeParse,
    safeLocalStorageGetItem,
    safeLocalStorageSetItem,
  } = helpers;

  const themeApi = window.dbWalletTheme || null;

  const DEVICE_KEY_STORAGE = "db-wallet:device";
  const THEME_KEY_STORAGE =
    themeApi && typeof themeApi.THEME_KEY === "string"
      ? themeApi.THEME_KEY
      : "db-wallet:theme";

  function isReservedStorageKey(key) {
    return (
      key === REGISTRY_KEY ||
      key === DEVICE_KEY_STORAGE ||
      key === THEME_KEY_STORAGE
    );
  }

  function userIdExists(userId) {
    if (!userId) return false;
    return !!safeLocalStorageGetItem(STORAGE_PREFIX + userId);
  }

  function makeUniqueUserId(base) {
    let candidate = base;
    let i = 2;
    while (userIdExists(candidate)) {
      candidate = `${base}-${i}`;
      i++;
    }
    return candidate;
  }

  function ensureNonReservedUserId(userId) {
    const raw = String(userId || "").trim();
    if (!raw) {
      return makeUniqueUserId("user-" + randomId());
    }
    if (
      raw.startsWith("import:") ||
      raw.startsWith("i2:") ||
      raw.startsWith("i2u:") ||
      raw.startsWith("ac:")
    ) {
      return makeUniqueUserId("user-" + raw);
    }
    if (!isReservedStorageKey(STORAGE_PREFIX + raw)) {
      return raw;
    }
    return makeUniqueUserId("user-" + raw);
  }

  function getDeviceKey() {
    try {
      const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
      if (existing) return existing;
    } catch (e) {
      // ignore
    }
    const created = randomWalletId(6);
    try {
      localStorage.setItem(DEVICE_KEY_STORAGE, created);
    } catch (e) {
      // ignore
    }
    return created;
  }

  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];

  function normalizeDeviceSymbol(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const ch = raw[0];
    return DEVICE_SYMBOLS.includes(ch) ? ch : "";
  }

  function clampTs(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
    const ts = Number.isFinite(n) ? Math.floor(n) : 0;
    return ts > 0 ? ts : 0;
  }

  function ensureWalletDevices(wallet) {
    if (!wallet || typeof wallet !== "object") return [];
    const raw = wallet.devices;
    const arr = Array.isArray(raw) ? raw : [];

    const byKey = new Map();
    for (const d of arr) {
      if (!d || typeof d !== "object") continue;
      const deviceKey =
        typeof d.deviceKey === "string" ? d.deviceKey.trim() : "";
      if (!deviceKey) continue;
      const lastSeenAt = clampTs(d.lastSeenAt);
      const symbol = normalizeDeviceSymbol(d.symbol) || null;

      const existing = byKey.get(deviceKey);
      if (!existing) {
        byKey.set(deviceKey, { deviceKey, symbol, lastSeenAt });
        continue;
      }
      const nextLastSeenAt = Math.max(existing.lastSeenAt, lastSeenAt);
      let nextSymbol = existing.symbol;
      if (lastSeenAt > existing.lastSeenAt) {
        nextSymbol = symbol;
      } else if (lastSeenAt === existing.lastSeenAt) {
        if (!nextSymbol && symbol) nextSymbol = symbol;
      }
      byKey.set(deviceKey, {
        deviceKey,
        symbol: nextSymbol,
        lastSeenAt: nextLastSeenAt,
      });
    }

    const items = Array.from(byKey.values()).sort((a, b) => {
      if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
      return a.deviceKey.localeCompare(b.deviceKey);
    });

    // Deterministic symbol de-duplication:
    // Keep the symbol on the most recently seen device; others become unassigned (null).
    const taken = new Set();
    for (const d of items) {
      if (d.symbol && !taken.has(d.symbol)) {
        taken.add(d.symbol);
      } else if (d.symbol) {
        d.symbol = null;
      }
    }

    // Auto-evict to max 6 (drop oldest; deterministic ties by deviceKey).
    const MAX_DEVICES = 6;
    const trimmed = items.slice(0, MAX_DEVICES);
    wallet.devices = trimmed;
    return trimmed;
  }

  function getLocalDeviceSymbol(wallet) {
    if (!wallet || typeof wallet !== "object") return "";
    const deviceKey = getDeviceKey();
    const devices = ensureWalletDevices(wallet);
    const entry = devices.find((d) => d && d.deviceKey === deviceKey);
    return entry && entry.symbol ? entry.symbol : "";
  }

  function setLocalDeviceSymbol(wallet, symbol) {
    const normalized = normalizeDeviceSymbol(symbol);
    if (!normalized) return false;
    if (!wallet || typeof wallet !== "object") return false;
    const deviceKey = getDeviceKey();
    const devices = ensureWalletDevices(wallet);
    const now = Date.now();

    const existingIdx = devices.findIndex(
      (d) => d && d.deviceKey === deviceKey,
    );
    const nextEntry = { deviceKey, symbol: normalized, lastSeenAt: now };
    const next = existingIdx >= 0 ? devices.slice() : devices.slice();
    if (existingIdx >= 0) next[existingIdx] = nextEntry;
    else next.unshift(nextEntry);
    wallet.devices = next;
    ensureWalletDevices(wallet);
    return true;
  }

  function touchLocalDevice(wallet) {
    if (!wallet || typeof wallet !== "object") return false;
    const deviceKey = getDeviceKey();
    const devices = ensureWalletDevices(wallet);
    const now = Date.now();

    const idx = devices.findIndex((d) => d && d.deviceKey === deviceKey);
    if (idx >= 0) {
      devices[idx] = {
        deviceKey,
        symbol: devices[idx].symbol || null,
        lastSeenAt: now,
      };
    } else {
      devices.unshift({ deviceKey, symbol: null, lastSeenAt: now });
    }
    wallet.devices = devices;
    ensureWalletDevices(wallet);
    return true;
  }

  function mergeWalletDevices(wallet, remoteDevices) {
    if (!wallet || typeof wallet !== "object") return [];
    const local = ensureWalletDevices(wallet);
    const remote = Array.isArray(remoteDevices) ? remoteDevices : [];
    wallet.devices = local.concat(remote);
    return ensureWalletDevices(wallet);
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

  function ensureDeviceSeq(wallet) {
    if (!wallet || typeof wallet !== "object") return;
    const deviceKey = getDeviceKey();
    if (!wallet.seq || typeof wallet.seq !== "object") {
      wallet.seq = {};
    }

    let maxSeq = 0;
    for (const e of wallet.events || []) {
      const parsed = parseCompactEventId(e && e.id);
      if (parsed && parsed.deviceKey === deviceKey && parsed.seq > maxSeq) {
        maxSeq = parsed.seq;
      }
    }

    const current = wallet.seq[deviceKey];
    const currentNum =
      typeof current === "number" && Number.isFinite(current)
        ? Math.floor(current)
        : 0;
    if (currentNum <= maxSeq) {
      wallet.seq[deviceKey] = maxSeq + 1;
    }
  }

  function nextEventId(wallet) {
    const deviceKey = getDeviceKey();
    if (!wallet.seq || typeof wallet.seq !== "object") {
      wallet.seq = {};
    }
    if (typeof wallet.seq[deviceKey] !== "number") {
      let maxSeq = 0;
      for (const e of wallet.events || []) {
        const parsed = parseCompactEventId(e && e.id);
        if (parsed && parsed.deviceKey === deviceKey && parsed.seq > maxSeq) {
          maxSeq = parsed.seq;
        }
      }
      wallet.seq[deviceKey] = maxSeq + 1;
    }

    const seq = wallet.seq[deviceKey];
    wallet.seq[deviceKey] = seq + 1;
    return `${deviceKey}.${seq.toString(36)}`;
  }

  function loadWallet(userId, parsedOverride) {
    const hasParsedOverride =
      parsedOverride && typeof parsedOverride === "object";
    const raw = hasParsedOverride
      ? null
      : safeLocalStorageGetItem(STORAGE_PREFIX + userId);
    if (!raw && !hasParsedOverride) {
      return {
        userId,
        walletId: randomWalletId(),
        deviceId: randomId(),
        v: 2,
        seq: {},
        events: [],
        actionCodes: [],
        devices: [],
      };
    }
    const obj = hasParsedOverride ? parsedOverride : safeParse(raw) || {};
    if (!Array.isArray(obj.events)) obj.events = [];
    if (!Array.isArray(obj.actionCodes)) obj.actionCodes = [];
    if (!Array.isArray(obj.devices)) obj.devices = [];
    if (!obj.deviceId) obj.deviceId = randomId();
    if (!obj.walletId) obj.walletId = randomWalletId();
    if (!obj.seq || typeof obj.seq !== "object") obj.seq = {};
    obj.userId = userId;
    if (Array.isArray(obj.events)) {
      const normalizedEvents = [];
      for (const ev of obj.events) {
        if (!ev || typeof ev !== "object") continue;
        if (
          typeof ev.id !== "string" ||
          !ev.id ||
          typeof ev.t !== "string" ||
          !ev.t
        ) {
          continue;
        }

        if (typeof ev.ts !== "number" || !Number.isFinite(ev.ts)) {
          const parsedTs =
            typeof ev.ts === "string" && ev.ts.trim() !== ""
              ? Number(ev.ts)
              : NaN;
          if (Number.isFinite(parsedTs)) {
            ev.ts = parsedTs;
          } else {
            continue;
          }
        }

        if (ev.t === "p") {
          if ("n" in ev) delete ev.n;
        } else if (ev.t === "d" || ev.t === "s" || ev.t === "g") {
          let rawN = 1;
          if (typeof ev.n === "number" && Number.isFinite(ev.n)) {
            rawN = Math.round(ev.n);
          } else if (typeof ev.n === "string" && ev.n.trim() !== "") {
            const parsedN = parseInt(ev.n, 10);
            if (typeof parsedN === "number" && Number.isFinite(parsedN)) {
              rawN = parsedN;
            }
          }
          ev.n = rawN > 0 ? rawN : 1;
        }

        normalizedEvents.push(ev);
      }
      obj.events = normalizedEvents;
    }
    const storedV =
      typeof obj.v === "number" && Number.isFinite(obj.v) ? obj.v : 1;
    const allCompact = obj.events.every((e) => {
      const id = e && typeof e.id === "string" ? e.id : "";
      return !!parseCompactEventId(id);
    });
    if (allCompact) {
      obj.v = storedV < 2 ? 2 : storedV;
    } else {
      obj.v = 1;
    }
    ensureWalletDevices(obj);
    return obj;
  }

  let hasShownStorageWriteError = false;

  function saveWallet(wallet) {
    if (!wallet || !wallet.userId) return;

    const storageKey = STORAGE_PREFIX + wallet.userId;
    if (isReservedStorageKey(storageKey)) {
      if (!hasShownStorageWriteError) {
        hasShownStorageWriteError = true;
        alert(
          "Ungültige Nutzer-ID (kollidiert mit internen Storage-Keys). Speichern verweigert.",
        );
      }
      return;
    }

    const json = JSON.stringify(wallet);

    // Hauptspeicherort
    if (!safeLocalStorageSetItem(storageKey, json)) {
      if (!hasShownStorageWriteError) {
        hasShownStorageWriteError = true;
        alert(
          "Konnte nicht speichern (Storage voll oder blockiert). Änderungen sind nicht gesichert.",
        );
      }
      return;
    }

    // Legacy-Key für mögliche ältere Versionen (nur userId)
    if (
      typeof wallet.userId === "string" &&
      wallet.userId &&
      !wallet.userId.includes(":")
    ) {
      safeLocalStorageSetItem(wallet.userId, json);
    }

    // Registry aktualisieren
    const reg = loadRegistry();
    reg[wallet.userId] = {
      userId: wallet.userId,
      storageKey,
      lastUpdated: Date.now(),
    };
    saveRegistry(reg);
  }

  function getAllWallets() {
    const all = {};
    const seenUserIds = new Set();

    let len = 0;
    try {
      len =
        typeof localStorage !== "undefined" && localStorage
          ? localStorage.length
          : 0;
    } catch (e) {
      return all;
    }

    for (let i = 0; i < len; i++) {
      let key = null;
      try {
        key = localStorage.key(i);
      } catch (e) {
        continue;
      }
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;

      const raw = safeLocalStorageGetItem(key);
      if (!raw) continue;

      const obj = safeParse(raw);
      if (!obj || typeof obj !== "object" || !Array.isArray(obj.events)) {
        continue; // skip non-wallet keys like registry/theme
      }

      const userIdFromKey = key.slice(STORAGE_PREFIX.length);
      const userId =
        typeof obj.userId === "string"
          ? STORAGE_PREFIX + obj.userId === key
            ? obj.userId
            : userIdFromKey
          : userIdFromKey;
      if (!userId) continue;
      if (isReservedStorageKey(STORAGE_PREFIX + userId)) continue;

      if (seenUserIds.has(userId)) continue;
      seenUserIds.add(userId);
      all[userId] = loadWallet(userId, obj);
    }

    return all;
  }

  function findUserIdByWalletId(walletId) {
    if (!walletId) return null;
    let len = 0;
    try {
      len =
        typeof localStorage !== "undefined" && localStorage
          ? localStorage.length
          : 0;
    } catch (e) {
      return null;
    }

    for (let i = 0; i < len; i++) {
      let key = null;
      try {
        key = localStorage.key(i);
      } catch (e) {
        continue;
      }
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;

      const raw = safeLocalStorageGetItem(key);
      if (!raw) continue;

      const obj = safeParse(raw);
      if (!obj || typeof obj !== "object" || !Array.isArray(obj.events)) {
        continue;
      }
      if (obj.walletId === walletId) {
        const userId =
          typeof obj.userId === "string"
            ? obj.userId
            : key.slice(STORAGE_PREFIX.length);
        return userId || null;
      }
    }
    return null;
  }

  function walletIdForUserId(userId) {
    if (!userId) return null;
    const raw = safeLocalStorageGetItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const obj = safeParse(raw);
    return obj && typeof obj.walletId === "string" ? obj.walletId : null;
  }

  window.dbWalletStorage = {
    DEVICE_KEY_STORAGE,
    THEME_KEY_STORAGE,
    isReservedStorageKey,
    ensureNonReservedUserId,
    getDeviceKey,
    ensureWalletDevices,
    getLocalDeviceSymbol,
    setLocalDeviceSymbol,
    touchLocalDevice,
    mergeWalletDevices,
    parseCompactEventId,
    ensureDeviceSeq,
    nextEventId,
    loadWallet,
    saveWallet,
    getAllWallets,
    userIdExists,
    makeUniqueUserId,
    findUserIdByWalletId,
    walletIdForUserId,
  };
})();
