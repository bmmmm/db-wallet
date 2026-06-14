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

  function isValidUserId(userId) {
    const raw = typeof userId === "string" ? userId.trim() : "";
    if (!raw) return false;
    const router = window.dbWalletHashRouter || null;
    if (router && typeof router.isReservedHashPrefix === "function") {
      if (router.isReservedHashPrefix(raw)) return false;
    }
    return true;
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
      raw.startsWith("ac:") ||
      raw.startsWith("acg:")
    ) {
      return makeUniqueUserId("user-" + raw);
    }
    if (!isReservedStorageKey(STORAGE_PREFIX + raw)) {
      return raw;
    }
    return makeUniqueUserId("user-" + raw);
  }

  // When storage is unavailable (private mode / quota) the generated key can't be
  // persisted; cache it in memory so every call within the session returns the
  // same device key instead of a fresh random one each time (which would break
  // seq monotonicity and fabricate phantom devices in the event log).
  let fallbackDeviceKey = null;

  function getDeviceKey() {
    try {
      const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
      if (existing) return existing;
    } catch (e) {
      // ignore
    }
    if (fallbackDeviceKey) return fallbackDeviceKey;
    const created = randomWalletId(6);
    try {
      localStorage.setItem(DEVICE_KEY_STORAGE, created);
    } catch (e) {
      // ignore
    }
    fallbackDeviceKey = created;
    return created;
  }

  const DEVICE_SYMBOLS = helpers.DEVICE_SYMBOLS;

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
    // Always keep the local device, even if 6+ imported devices are more recent —
    // otherwise this device's chosen symbol vanishes after a sync.
    const MAX_DEVICES = 6;
    let trimmed;
    if (items.length <= MAX_DEVICES) {
      trimmed = items;
    } else {
      const localKey = getDeviceKey();
      const localIdx = items.findIndex((d) => d.deviceKey === localKey);
      if (localIdx >= MAX_DEVICES) {
        // Local device would be evicted by recency — pin it in, dropping the
        // oldest of the otherwise-kept devices instead.
        trimmed = items.slice(0, MAX_DEVICES - 1);
        trimmed.push(items[localIdx]);
      } else {
        trimmed = items.slice(0, MAX_DEVICES);
      }
    }
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
    const next = devices.slice();
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

  const parseCompactEventId = helpers.parseCompactEventId;

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

  function buildTombstoneEvent(wallet, refId, ts) {
    const ref = typeof refId === "string" ? refId.trim() : "";
    if (!ref) return null;
    const stamp =
      typeof ts === "number" && Number.isFinite(ts)
        ? Math.floor(ts)
        : Date.now();
    return {
      id: nextEventId(wallet),
      t: "x",
      ref,
      ts: stamp,
    };
  }

  function appendTombstone(wallet, refId, ts) {
    if (!wallet || typeof wallet !== "object") return null;
    if (!Array.isArray(wallet.events)) wallet.events = [];
    const ev = buildTombstoneEvent(wallet, refId, ts);
    if (!ev) return null;
    wallet.events.push(ev);
    return ev;
  }

  function undoLastEvent(wallet) {
    if (!wallet || typeof wallet !== "object") return null;
    const events = Array.isArray(wallet.events) ? wallet.events : [];
    if (!events.length) return null;

    const sorted = events.slice().sort(helpers.compareEventsByTime);
    const summaryApi = window.dbWalletSummary || null;
    let effective = null;
    if (summaryApi && typeof summaryApi.applyTombstones === "function") {
      const res = summaryApi.applyTombstones(sorted);
      effective =
        res && Array.isArray(res.effectiveEvents) ? res.effectiveEvents : [];
    } else {
      effective = sorted.filter((e) => e && e.t !== "x");
    }

    if (!effective.length) return null;
    const target = effective[effective.length - 1];
    if (!target || typeof target.id !== "string" || !target.id) return null;

    const tombstone = appendTombstone(wallet, target.id);
    if (!tombstone) return null;
    ensureDeviceSeq(wallet);
    saveWallet(wallet);
    return tombstone;
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

  // Sanity ceiling for a single event's amount — far above any real drink count.
  // Mirrors wallet-import-v2's MAX_DECODED_AMOUNT; clamps poisoned/absurd values
  // (e.g. from a crafted legacy JSON import) at the storage boundary so they can't
  // corrupt the balance or, once re-encoded, overflow the varint writer.
  const MAX_EVENT_AMOUNT = 1000000000;

  function loadWallet(userId, parsedOverride) {
    const rawUserId = typeof userId === "string" ? userId.trim() : "";
    if (!isValidUserId(rawUserId)) return null;
    userId = rawUserId;
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
          // Keep the event instead of dropping it on a corrupt ts — dropping
          // silently loses a real drink/pay, and the loss is then persisted on the
          // next save. ts=0 (epoch) sorts it first, matching the summary normalizer.
          ev.ts = Number.isFinite(parsedTs) ? parsedTs : 0;
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
          ev.n = rawN > 0 ? Math.min(rawN, MAX_EVENT_AMOUNT) : 1;
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
  let storageFailedActive = false;

  // Surface persistent storage failures (quota exceeded / disabled storage in
  // private mode) instead of going silent after the first alert. Sets an
  // observable body flag and a persistent banner; cleared on the next good write.
  function markStorageFailed(failed, message) {
    if (failed && storageFailedActive) return;
    if (!failed && !storageFailedActive) return;
    storageFailedActive = !!failed;
    try {
      if (document && document.body && document.body.dataset) {
        if (failed) document.body.dataset.storageFailed = "1";
        else delete document.body.dataset.storageFailed;
      }
      const msgApi = window.dbWalletMessages || null;
      if (msgApi) {
        if (failed) {
          msgApi.showGlobal(
            message ||
              "⚠️ Speichern fehlgeschlagen — neue Änderungen sind nicht gesichert (Speicher voll oder blockiert).",
            { id: "storage-error-banner", className: "action-codes-notice" },
          );
        } else {
          msgApi.clearGlobal({ id: "storage-error-banner" });
        }
      }
    } catch (e) {
      // ignore — never let the failure indicator itself throw
    }
  }

  function saveWallet(wallet) {
    if (!wallet || !wallet.userId) return false;

    const storageKey = STORAGE_PREFIX + wallet.userId;
    if (isReservedStorageKey(storageKey)) {
      markStorageFailed(
        true,
        "⚠️ Ungültige Nutzer-ID (kollidiert mit internen Storage-Keys). Speichern verweigert.",
      );
      if (!hasShownStorageWriteError) {
        hasShownStorageWriteError = true;
        alert(
          "Ungültige Nutzer-ID (kollidiert mit internen Storage-Keys). Speichern verweigert.",
        );
      }
      return false;
    }

    const json = JSON.stringify(wallet);

    // Hauptspeicherort
    if (!safeLocalStorageSetItem(storageKey, json)) {
      markStorageFailed(true);
      if (!hasShownStorageWriteError) {
        hasShownStorageWriteError = true;
        alert(
          "Konnte nicht speichern (Storage voll oder blockiert). Änderungen sind nicht gesichert.",
        );
      }
      return false;
    }

    // Registry aktualisieren
    const reg = loadRegistry();
    reg[wallet.userId] = {
      userId: wallet.userId,
      storageKey,
      lastUpdated: Date.now(),
    };
    saveRegistry(reg);

    markStorageFailed(false);
    return true;
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
      const loaded = loadWallet(userId, obj);
      if (!loaded) continue;
      all[userId] = loaded;
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
    buildTombstoneEvent,
    appendTombstone,
    undoLastEvent,
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
