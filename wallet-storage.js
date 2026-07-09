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
    const existing = safeLocalStorageGetItem(DEVICE_KEY_STORAGE);
    if (existing) return existing;
    if (fallbackDeviceKey) return fallbackDeviceKey;
    const created = randomWalletId(6);
    safeLocalStorageSetItem(DEVICE_KEY_STORAGE, created);
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

  // Highest seq already used by a device across the wallet's events. Shared by
  // ensureDeviceSeq and nextEventId so both agree on where the next id starts.
  function maxSeqForDevice(wallet, deviceKey) {
    let maxSeq = 0;
    for (const e of (wallet && wallet.events) || []) {
      const parsed = parseCompactEventId(e && e.id);
      if (parsed && parsed.deviceKey === deviceKey && parsed.seq > maxSeq) {
        maxSeq = parsed.seq;
      }
    }
    return maxSeq;
  }

  // Highest event ts currently in the log (0 when none). Used to stamp locally
  // built tombstones strictly after the newest event so they always sort last.
  function maxEventTs(wallet) {
    let maxTs = 0;
    for (const e of (wallet && wallet.events) || []) {
      if (e && typeof e.ts === "number" && Number.isFinite(e.ts) && e.ts > maxTs) {
        maxTs = e.ts;
      }
    }
    return maxTs;
  }

  function ensureDeviceSeq(wallet) {
    if (!wallet || typeof wallet !== "object") return;
    const deviceKey = getDeviceKey();
    if (!wallet.seq || typeof wallet.seq !== "object") {
      wallet.seq = {};
    }

    const maxSeq = maxSeqForDevice(wallet, deviceKey);

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
    // With an explicit ts (e.g. a decoded remote tombstone keeping its wire ts)
    // honor it verbatim. Otherwise default to strictly after the newest event so
    // locally built delete/undo tombstones always sort last, even against future-
    // dated entries or a backward-skewed clock. Callers no longer scan for this.
    const stamp =
      typeof ts === "number" && Number.isFinite(ts)
        ? Math.floor(ts)
        : Math.max(Date.now(), maxEventTs(wallet) + 1);
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

  // Pure resolution of what an undo would act on — shared by undoLastEvent and
  // the UI's pre-undo confirm so the confirm always matches the actual outcome.
  // Returns { type: "undo", id, event, afterDeletion } or null if nothing to
  // undo. Undo is MONOTONIC (it removes the last effective entry); it never
  // neutralizes its own trailing tombstone, otherwise repeated presses would
  // ping-pong the last entry instead of walking back through the log. The
  // afterDeletion flag lets the UI confirm when the previous action was a delete
  // (so removing a *different* visible entry isn't silent — the finding's gap).
  function resolveUndoTarget(wallet) {
    if (!wallet || typeof wallet !== "object") return null;
    const events = Array.isArray(wallet.events) ? wallet.events : [];
    if (!events.length) return null;

    const sorted = events.slice().sort(helpers.compareEventsByTime);
    const summaryApi = window.dbWalletSummary || null;
    const tomb =
      summaryApi && typeof summaryApi.applyTombstones === "function"
        ? summaryApi.applyTombstones(sorted)
        : null;

    const effective =
      tomb && Array.isArray(tomb.effectiveEvents)
        ? tomb.effectiveEvents
        : sorted.filter((e) => e && e.t !== "x");
    if (!effective.length) return null;
    const target = effective[effective.length - 1];
    if (!target || typeof target.id !== "string" || !target.id) return null;

    // afterDeletion = the last appended event was a real DELETE: a tombstone
    // that is neither itself neutralized nor a neutralizer (a tombstone-of-a-
    // tombstone, i.e. an undo-of-delete — its ref names a neutralized tombstone).
    const lastAppended = sorted[sorted.length - 1];
    const lastRef =
      lastAppended && typeof lastAppended.ref === "string"
        ? lastAppended.ref.trim()
        : "";
    const neutralized = tomb && tomb.neutralized ? tomb.neutralized : null;
    const afterDeletion = !!(
      lastAppended &&
      lastAppended.t === "x" &&
      typeof lastAppended.id === "string" &&
      lastAppended.id &&
      (!neutralized ||
        (!neutralized.has(lastAppended.id) && !neutralized.has(lastRef)))
    );

    // Tombstone the entry's ROOT so undoing an edited entry removes the whole
    // logical entry (all its replacements), not just the visible replacement.
    const rootId =
      summaryApi && typeof summaryApi.rootIdOf === "function"
        ? summaryApi.rootIdOf(target)
        : typeof target.supersedes === "string" && target.supersedes
          ? target.supersedes
          : target.id;
    return { type: "undo", id: rootId, event: target, afterDeletion };
  }

  // Returns the tombstone event on success, null when there is nothing to undo,
  // and { status: "failed" } when the write failed — so the caller can tell a
  // real save failure apart from an empty log and surface a dialog. (The success
  // path keeps returning the event itself for existing consumers.) The tombstone
  // ts default (strictly after the newest event) now lives in buildTombstoneEvent.
  // `plan` is optional: undoLast passes its already-resolved target to avoid a
  // second resolveUndoTarget pass; without one we resolve here.
  function undoLastEvent(wallet, plan) {
    const target = plan || resolveUndoTarget(wallet);
    if (!target) return null;

    const before = wallet.events.slice();
    const tombstone = appendTombstone(wallet, target.id);
    if (!tombstone) return null;
    ensureDeviceSeq(wallet);
    if (!saveWallet(wallet)) {
      wallet.events = before; // roll back optimistic append on a failed write
      return { status: "failed" };
    }
    return tombstone;
  }

  function nextEventId(wallet) {
    const deviceKey = getDeviceKey();
    if (!wallet.seq || typeof wallet.seq !== "object") {
      wallet.seq = {};
    }
    if (typeof wallet.seq[deviceKey] !== "number") {
      wallet.seq[deviceKey] = maxSeqForDevice(wallet, deviceKey) + 1;
    }

    const seq = wallet.seq[deviceKey];
    wallet.seq[deviceKey] = seq + 1;
    return `${deviceKey}.${seq.toString(36)}`;
  }

  // Canonical event factory — a fresh id + timestamp for a drink/pay/credit.
  // Shared so callers (wallet-actions, sync, UI) all mint identical shapes.
  function newEvent(wallet, type, n) {
    return {
      id: nextEventId(wallet),
      t: type,
      n: typeof n === "number" ? n : undefined,
      ts: Date.now(),
    };
  }

  // Append events and persist, rolling back the optimistic in-memory append when
  // the write fails (quota exceeded / disabled storage). Returns true on success,
  // false on failure. Snapshots the array (not just its length) because saveWallet
  // re-reads and union-merges the persisted snapshot on every write and may
  // legitimately replace wallet.events — so restoring the exact pre-append array
  // is the only correct rollback.
  function appendEvents(wallet, eventsArray) {
    if (!wallet || typeof wallet !== "object") return false;
    if (!Array.isArray(wallet.events)) wallet.events = [];
    const before = wallet.events.slice();
    for (const ev of eventsArray || []) {
      wallet.events.push(ev);
    }
    if (saveWallet(wallet)) return true;
    wallet.events = before;
    return false;
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

        if (
          typeof ev.ts !== "number" ||
          !Number.isFinite(ev.ts) ||
          ev.ts < 0
        ) {
          const parsedTs =
            typeof ev.ts === "string" && ev.ts.trim() !== ""
              ? Number(ev.ts)
              : NaN;
          // Keep the event instead of dropping it on a corrupt ts — dropping
          // silently loses a real drink/pay, and the loss is then persisted on the
          // next save. ts=0 (epoch) sorts it first, matching the summary normalizer.
          // A NEGATIVE ts is also clamped to 0: it is a finite number so it would
          // otherwise slip through unnormalized and later make the export codec's
          // unsigned varint writer throw (bricking every QR/link export).
          ev.ts = Number.isFinite(parsedTs) && parsedTs >= 0 ? parsedTs : 0;
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

  // Two events sharing an id are "the same booking" only when every other field
  // matches; a mismatch is a real cross-tab id collision (same seq, different
  // content) that must not be deduped away.
  function sameEventContent(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    return (
      a.t === b.t &&
      a.n === b.n &&
      a.ts === b.ts &&
      (a.ref || "") === (b.ref || "") &&
      (a.supersedes || "") === (b.supersedes || "") &&
      (a.oid || "") === (b.oid || "")
    );
  }

  // Union two arrays of objects keyed by `keyName`; the local version wins on a
  // shared key. Used to reconcile action codes / devices with a concurrent tab's
  // persisted copy instead of clobbering it with our stale in-memory array.
  function unionArrayByKey(localArr, persistedArr, keyName) {
    const local = Array.isArray(localArr) ? localArr : [];
    const persisted = Array.isArray(persistedArr) ? persistedArr : [];
    if (!persisted.length) return local;
    const byKey = new Map();
    for (const item of persisted) {
      const k = item && typeof item[keyName] === "string" ? item[keyName] : null;
      if (k) byKey.set(k, item);
    }
    for (const item of local) {
      const k = item && typeof item[keyName] === "string" ? item[keyName] : null;
      if (k) byKey.set(k, item);
    }
    return Array.from(byKey.values());
  }

  // Field-wise reconcile of everything except events (handled by mergeEvents) so
  // saving from a stale in-memory wallet doesn't clobber a concurrent tab's
  // persisted action codes / devices / sync peers. Scalars stay local-wins.
  function reconcilePersistedFields(wallet, persisted) {
    if (Array.isArray(persisted.actionCodes)) {
      wallet.actionCodes = unionArrayByKey(
        wallet.actionCodes,
        persisted.actionCodes,
        "id",
      );
    }
    if (Array.isArray(persisted.globalActionCodes)) {
      wallet.globalActionCodes = unionArrayByKey(
        wallet.globalActionCodes,
        persisted.globalActionCodes,
        "id",
      );
    }
    if (Array.isArray(persisted.devices)) {
      wallet.devices = unionArrayByKey(
        wallet.devices,
        persisted.devices,
        "deviceKey",
      );
    }
    // syncPeers is a plain object map keyed by peer key — union keys, local wins.
    if (
      persisted.syncPeers &&
      typeof persisted.syncPeers === "object" &&
      !Array.isArray(persisted.syncPeers)
    ) {
      const merged = Object.create(null);
      for (const k of Object.keys(persisted.syncPeers)) {
        merged[k] = persisted.syncPeers[k];
      }
      const localPeers =
        wallet.syncPeers &&
        typeof wallet.syncPeers === "object" &&
        !Array.isArray(wallet.syncPeers)
          ? wallet.syncPeers
          : null;
      if (localPeers) {
        for (const k of Object.keys(localPeers)) {
          merged[k] = localPeers[k];
        }
      }
      wallet.syncPeers = merged;
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

    // Cross-tab reconciliation: another tab of the same wallet may have appended
    // events since we loaded. Re-read the persisted snapshot and union-merge it
    // into the in-memory wallet before writing — the append-only + dedup-by-id
    // model makes this a safe merge with no conflict logic, and it prevents
    // last-write-wins from silently clobbering a concurrent tab's bookings.
    try {
      const persistedRaw = safeLocalStorageGetItem(storageKey);
      if (persistedRaw) {
        const persisted = safeParse(persistedRaw);
        const mergeApi = window.dbWalletImportV2 || null;
        if (
          persisted &&
          typeof persisted === "object" &&
          Array.isArray(persisted.events) &&
          Array.isArray(wallet.events) &&
          mergeApi &&
          typeof mergeApi.mergeEvents === "function"
        ) {
          // Two tabs of the same wallet share the deviceKey and the persisted seq,
          // so they can mint the SAME id for DIFFERENT bookings. mergeEvents dedups
          // by id and (seeding local ids first) would drop the persisted event —
          // permanently losing a real booking. Detect same-id/different-content
          // collisions and re-mint the LOCAL event to a fresh seq above the combined
          // max, rewriting any local references (tombstone ref / supersedes) to it.
          // The persisted event keeps the original id. Content-identical duplicates
          // fall through to normal dedup, so mergeEvents' import contract is intact.
          const persistedById = new Map();
          for (const e of persisted.events) {
            if (e && typeof e.id === "string" && e.id) {
              persistedById.set(e.id, e);
            }
          }
          const nextSeqByDevice = new Map();
          const mintFreshId = (deviceKey) => {
            let next = nextSeqByDevice.get(deviceKey);
            if (next === undefined) {
              next =
                Math.max(
                  maxSeqForDevice(wallet, deviceKey),
                  maxSeqForDevice({ events: persisted.events }, deviceKey),
                ) + 1;
            }
            nextSeqByDevice.set(deviceKey, next + 1);
            return `${deviceKey}.${next.toString(36)}`;
          };
          const remap = new Map();
          for (const e of wallet.events) {
            if (!e || typeof e.id !== "string" || !e.id) continue;
            const clash = persistedById.get(e.id);
            if (clash && !sameEventContent(e, clash)) {
              const parsed = parseCompactEventId(e.id);
              const deviceKey = parsed ? parsed.deviceKey : getDeviceKey();
              const freshId = mintFreshId(deviceKey);
              remap.set(e.id, freshId);
              e.id = freshId;
            }
          }
          if (remap.size) {
            for (const e of wallet.events) {
              if (!e) continue;
              if (typeof e.ref === "string" && remap.has(e.ref)) {
                e.ref = remap.get(e.ref);
              }
              if (typeof e.supersedes === "string" && remap.has(e.supersedes)) {
                e.supersedes = remap.get(e.supersedes);
              }
            }
          }

          wallet.events = mergeApi.mergeEvents(wallet.events, persisted.events);
          // Reconcile the local seq counter to the merged max so the next id
          // mint can't collide with an event just merged in from another tab.
          ensureDeviceSeq(wallet);
          // Reconcile the remaining fields too — otherwise a concurrent tab's
          // action codes / devices / sync peers get clobbered by our stale copy.
          reconcilePersistedFields(wallet, persisted);
        }
      }
    } catch (e) {
      // Never let reconciliation block a save — fall through to a plain write.
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
    // null-prototype: imported wallet userIds become bracket-assigned keys here,
    // so a "__proto__"/"constructor" userId must create an ordinary own property
    // rather than poison the prototype chain.
    const all = Object.create(null);
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
    resolveUndoTarget,
    undoLastEvent,
    nextEventId,
    newEvent,
    appendEvents,
    loadWallet,
    saveWallet,
    getAllWallets,
    userIdExists,
    makeUniqueUserId,
    findUserIdByWalletId,
    walletIdForUserId,
  };
})();
