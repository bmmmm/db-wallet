(function () {
  const helpers = window.dbWalletHelpers || null;
  const storage = window.dbWalletStorage || null;
  if (!helpers || !storage) return;

  const themeApi = window.dbWalletTheme || null;
  const canonicalThemeName =
    themeApi && typeof themeApi.canonicalThemeName === "function"
      ? themeApi.canonicalThemeName
      : (name) => String(name || "").trim();
  const applyThemeRaw =
    themeApi && typeof themeApi.applyTheme === "function"
      ? themeApi.applyTheme
      : () => false;

  const {
    randomId,
    randomWalletId,
    base64UrlDecode,
    base64UrlDecodeBytes,
    base64UrlEncodeBytes,
    gzipDecompress,
    safeParse,
  } = helpers;

  const {
    getDeviceKey,
    parseCompactEventId,
    ensureWalletDevices,
    mergeWalletDevices,
    ensureDeviceSeq,
    nextEventId,
    loadWallet,
    saveWallet,
    userIdExists,
    makeUniqueUserId,
    findUserIdByWalletId,
    walletIdForUserId,
    ensureNonReservedUserId,
  } = storage;

  const THEME_NAMES = [
    "Nord Glow",
    "Cyan Mist",
    "Lilac Carbon",
    "Teal Ember",
    "Slate Sunrise",
    "Paper Mint",
    "Peach Cloud",
  ];

  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];

  function cmpStr(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  const mergeEncoder = new TextEncoder();

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
    const bytes = mergeEncoder.encode(String(str || ""));
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

  function legacyIdToV2Id(legacyId) {
    if (!legacyId || typeof legacyId !== "string") return null;
    if (!legacyId.includes("-")) return null;
    const device = extractLegacyDeviceKey(legacyId);
    const seq = hash53(legacyId);
    return `${device}.${seq.toString(36)}`;
  }

  function mergeEvents(localEvents, remoteEvents) {
    const merged = [];
    const seen = new Set();

    function addSeenId(id) {
      if (!id || typeof id !== "string") return;
      seen.add(id);
      const alias = legacyIdToV2Id(id);
      if (alias) seen.add(alias);
    }

    function addEvent(e) {
      merged.push(e);
      if (!e || typeof e !== "object") return;
      addSeenId(e.id);
      addSeenId(e.oid);
    }

    for (const e of localEvents || []) {
      if (e && typeof e.id === "string" && e.id) addEvent(e);
    }
    for (const e of remoteEvents || []) {
      if (!e || typeof e.id !== "string" || !e.id) continue;
      const aliasId = legacyIdToV2Id(e.id);
      const aliasOid = legacyIdToV2Id(e.oid);
      if (
        seen.has(e.id) ||
        (e.oid && typeof e.oid === "string" && seen.has(e.oid)) ||
        (aliasId && seen.has(aliasId)) ||
        (aliasOid && seen.has(aliasOid))
      ) {
        continue;
      }
      addEvent(e);
    }
    return merged;
  }

  function writeVarUint(value, out) {
    let n = Number(value);
    if (!isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
      throw new Error("Invalid varint value");
    }
    n = Math.floor(n);
    while (n >= 0x80) {
      out.push(n % 0x80 | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  }

  function readVarUint(bytes, offset) {
    let result = 0;
    let multiplier = 1;
    while (true) {
      if (offset >= bytes.length) {
        throw new Error("Truncated varint");
      }
      const b = bytes[offset++];
      result += (b & 0x7f) * multiplier;
      if (result > Number.MAX_SAFE_INTEGER) {
        throw new Error("Varint too large");
      }
      if ((b & 0x80) === 0) break;
      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        throw new Error("Varint too large");
      }
    }
    return [result, offset];
  }

  function themeIndexFromName(name) {
    const canonical = canonicalThemeName(name);
    const idx = THEME_NAMES.indexOf(canonical);
    return idx >= 0 ? idx : 255;
  }

  function themeNameFromIndex(idx) {
    return idx >= 0 && idx < THEME_NAMES.length ? THEME_NAMES[idx] : null;
  }

  function decodeImportV2Bytes(bytes) {
    if (
      bytes.length < 5 ||
      bytes[0] !== 100 || // d
      bytes[1] !== 98 || // b
      bytes[2] !== 119 || // w
      bytes[3] !== 2
    ) {
      throw new Error("Invalid v2 payload");
    }

    let offset = 4;
    const themeIdx = bytes[offset++];
    const [walletV, o1] = readVarUint(bytes, offset);
    offset = o1;

    const [walletIdLen, o2] = readVarUint(bytes, offset);
    offset = o2;
    const walletIdBytes = bytes.slice(offset, offset + walletIdLen);
    offset += walletIdLen;
    const walletId = base64UrlEncodeBytes(walletIdBytes);

    const decoder = new TextDecoder();
    const [userIdLen, o3] = readVarUint(bytes, offset);
    offset = o3;
    const userId = decoder.decode(bytes.slice(offset, offset + userIdLen));
    offset += userIdLen;

    const [deviceCount, o4] = readVarUint(bytes, offset);
    offset = o4;
    const deviceKeys = [];
    for (let i = 0; i < deviceCount; i++) {
      const [len, o5] = readVarUint(bytes, offset);
      offset = o5;
      const key = decoder.decode(bytes.slice(offset, offset + len));
      offset += len;
      deviceKeys.push(key);
    }

    const [baseTsMin, o6] = readVarUint(bytes, offset);
    offset = o6;

    const [eventCount, o7] = readVarUint(bytes, offset);
    offset = o7;

    const events = [];
    let tsMin = baseTsMin;
    let lastMinute = tsMin;
    let withinMinute = -1;
    for (let i = 0; i < eventCount; i++) {
      const [delta, o8] = readVarUint(bytes, offset);
      offset = o8;
      tsMin += delta;
      if (tsMin === lastMinute) {
        withinMinute = Math.min(withinMinute + 1, 59999);
      } else {
        lastMinute = tsMin;
        withinMinute = 0;
      }

      const typeFlags = bytes[offset++];
      const typeCode = typeFlags & 0x03;
      const hasAmount = (typeFlags & 0x04) !== 0;
      const idIsString = (typeFlags & 0x08) !== 0;

      let amount = 1;
      if (hasAmount) {
        const [n, o9] = readVarUint(bytes, offset);
        offset = o9;
        amount = n;
      }

      let id = "";
      if (idIsString) {
        const [len, o10] = readVarUint(bytes, offset);
        offset = o10;
        id = decoder.decode(bytes.slice(offset, offset + len));
        offset += len;
      } else {
        const [deviceIndex, o10] = readVarUint(bytes, offset);
        offset = o10;
        const [seq, o11] = readVarUint(bytes, offset);
        offset = o11;
        const deviceKey = deviceKeys[deviceIndex] || "dev";
        id = `${deviceKey}.${seq.toString(36)}`;
      }

      const t =
        typeCode === 0
          ? "d"
          : typeCode === 1
            ? "s"
            : typeCode === 2
              ? "p"
              : "g";

      const ev = {
        id,
        t,
        ts: tsMin * 60000 + withinMinute,
      };
      if (t !== "p") {
        ev.n = amount;
      }
      events.push(ev);
    }

    const theme = themeNameFromIndex(themeIdx);
    const decoded = {
      userId: userId || "user-" + randomId(),
      walletId,
      v: walletV || 1,
      events,
      theme,
    };

    // optional extensions:
    //  - action codes ("ac", v1/v2)
    //  - sync peer device id ("sp", v1)
    //  - device list ("dv", v1)
    //  - tombstones ("xt", v1)
    if (offset < bytes.length) {
      try {
        while (offset + 1 < bytes.length) {
          if (
            bytes[offset] === 97 && // "a"
            bytes[offset + 1] === 99 // "c"
          ) {
            offset += 2;
            const [acVersion, o8] = readVarUint(bytes, offset);
            offset = o8;
            if (acVersion === 1 || acVersion === 2) {
              const [count, o9] = readVarUint(bytes, offset);
              offset = o9;
              const actionCodes = [];
              for (let i = 0; i < count; i++) {
                const [idLen, o10] = readVarUint(bytes, offset);
                offset = o10;
                const id = decoder.decode(bytes.slice(offset, offset + idLen));
                offset += idLen;

                const [labelLen, o11] = readVarUint(bytes, offset);
                offset = o11;
                const label = decoder.decode(
                  bytes.slice(offset, offset + labelLen),
                );
                offset += labelLen;

                const [amount, o12] = readVarUint(bytes, offset);
                offset = o12;

                const [keyLen, o13] = readVarUint(bytes, offset);
                offset = o13;
                const key = decoder.decode(
                  bytes.slice(offset, offset + keyLen),
                );
                offset += keyLen;

                const [createdAt, o14] = readVarUint(bytes, offset);
                offset = o14;
                const [updatedAt, o15] = readVarUint(bytes, offset);
                offset = o15;

                let type = "g";
                if (acVersion === 2) {
                  const [typeCode, o16] = readVarUint(bytes, offset);
                  offset = o16;
                  type = typeCode === 1 ? "d" : "g";
                }

                actionCodes.push({
                  id,
                  label,
                  amount,
                  key,
                  createdAt,
                  updatedAt,
                  type,
                });
              }
              decoded.actionCodes = actionCodes;
            }
            continue;
          }

          if (
            bytes[offset] === 115 && // "s"
            bytes[offset + 1] === 112 // "p"
          ) {
            offset += 2;
            const [spVersion, o8] = readVarUint(bytes, offset);
            offset = o8;
            if (spVersion === 1) {
              const [len, o9] = readVarUint(bytes, offset);
              offset = o9;
              const deviceId = decoder.decode(
                bytes.slice(offset, offset + len),
              );
              offset += len;
              if (deviceId) decoded.deviceId = deviceId;
            }
            continue;
          }

          if (
            bytes[offset] === 100 && // "d"
            bytes[offset + 1] === 118 // "v"
          ) {
            offset += 2;
            const [dvVersion, o8] = readVarUint(bytes, offset);
            offset = o8;
            if (dvVersion === 1) {
              const [count, o9] = readVarUint(bytes, offset);
              offset = o9;
              const devices = [];
              for (let i = 0; i < count; i++) {
                const [keyLen, o10] = readVarUint(bytes, offset);
                offset = o10;
                const deviceKey = decoder.decode(
                  bytes.slice(offset, offset + keyLen),
                );
                offset += keyLen;

                const [symCode, o11] = readVarUint(bytes, offset);
                offset = o11;
                const symbol =
                  symCode >= 1 && symCode <= DEVICE_SYMBOLS.length
                    ? DEVICE_SYMBOLS[symCode - 1]
                    : null;

                const [lastSeenAt, o12] = readVarUint(bytes, offset);
                offset = o12;

                devices.push({
                  deviceKey,
                  symbol,
                  lastSeenAt,
                });
              }
              decoded.devices = devices;
            }
            continue;
          }

          if (
            bytes[offset] === 120 && // "x"
            bytes[offset + 1] === 116 // "t"
          ) {
            offset += 2;
            const [xtVersion, o8] = readVarUint(bytes, offset);
            offset = o8;
            if (xtVersion === 1) {
              const [count, o9] = readVarUint(bytes, offset);
              offset = o9;
              for (let i = 0; i < count; i++) {
                const [idLen, o10] = readVarUint(bytes, offset);
                offset = o10;
                const id = decoder.decode(bytes.slice(offset, offset + idLen));
                offset += idLen;

                const [refLen, o11] = readVarUint(bytes, offset);
                offset = o11;
                const ref = decoder.decode(
                  bytes.slice(offset, offset + refLen),
                );
                offset += refLen;

                const [tsMs, o12] = readVarUint(bytes, offset);
                offset = o12;

                if (id && ref) {
                  events.push({
                    id,
                    t: "x",
                    ref,
                    ts: tsMs,
                  });
                }
              }
            }
            continue;
          }

          break;
        }
      } catch (e) {
        // ignore trailing extension parse errors
      }
    }

    return decoded;
  }

  function encodeImportV2Bytes(wallet, themeName) {
    const encoder = new TextEncoder();
    const out = [];

    out.push(100, 98, 119, 2); // "dbw" + codec v2
    out.push(themeIndexFromName(themeName));
    writeVarUint(wallet && wallet.v ? wallet.v : 1, out);

    const walletIdStr =
      wallet && typeof wallet.walletId === "string"
        ? wallet.walletId
        : randomWalletId();
    const walletIdBytes = base64UrlDecodeBytes(walletIdStr);
    writeVarUint(walletIdBytes.length, out);
    for (const b of walletIdBytes) out.push(b);

    const userIdStr =
      wallet && typeof wallet.userId === "string"
        ? wallet.userId
        : "user-" + randomId();
    const userIdBytes = encoder.encode(userIdStr);
    writeVarUint(userIdBytes.length, out);
    for (const b of userIdBytes) out.push(b);

    const deviceKeyToIndex = new Map();
    const deviceKeys = [];

    const typeCodeMap = { d: 0, s: 1, p: 2, g: 3 };
    const events = [];
    const tombstones = [];
    for (const e of (wallet && wallet.events) || []) {
      if (!e || typeof e !== "object") continue;
      const t = typeof e.t === "string" ? e.t : "";
      if (t === "x") {
        const id = typeof e.id === "string" && e.id ? e.id : "";
        const ref = typeof e.ref === "string" ? e.ref.trim() : "";
        const tsMs =
          typeof e.ts === "number" && Number.isFinite(e.ts)
            ? Math.floor(e.ts)
            : 0;
        if (id && ref) {
          tombstones.push({ id, ref, tsMs });
        }
        continue;
      }
      if (typeCodeMap[t] === undefined) continue;
      const tsMs = typeof e.ts === "number" ? e.ts : 0;
      const tsMin = Math.floor(tsMs / 60000);
      const id = typeof e.id === "string" && e.id ? e.id : "";
      if (!id) continue;

      const parsed = parseCompactEventId(id);
      if (parsed) {
        if (!deviceKeyToIndex.has(parsed.deviceKey)) {
          deviceKeyToIndex.set(parsed.deviceKey, deviceKeys.length);
          deviceKeys.push(parsed.deviceKey);
        }
      }

      let amount = 1;
      if (t !== "p") {
        const n =
          typeof e.n === "number" && isFinite(e.n) ? Math.round(e.n) : 1;
        amount = n > 0 ? n : 1;
      }

      events.push({
        tsMin,
        tsMs,
        typeCode: typeCodeMap[t],
        amount,
        id,
        parsed,
      });
    }

    events.sort((a, b) => {
      if (a.tsMin !== b.tsMin) return a.tsMin - b.tsMin;
      if (a.tsMs !== b.tsMs) return a.tsMs - b.tsMs;
      return cmpStr(a.id, b.id);
    });

    writeVarUint(deviceKeys.length, out);
    for (const key of deviceKeys) {
      const bytes = encoder.encode(key);
      writeVarUint(bytes.length, out);
      for (const b of bytes) out.push(b);
    }

    const baseTsMin =
      events.length > 0 ? events[0].tsMin : Math.floor(Date.now() / 60000);
    writeVarUint(baseTsMin, out);
    writeVarUint(events.length, out);

    let prevTsMin = baseTsMin;
    for (const e of events) {
      const delta = e.tsMin - prevTsMin;
      prevTsMin = e.tsMin;
      writeVarUint(delta, out);

      let flags = e.typeCode & 0x03;
      if (e.typeCode !== 2 && e.amount !== 1) flags |= 0x04;
      const useStringId =
        !e.parsed || !deviceKeyToIndex.has(e.parsed.deviceKey);
      if (useStringId) flags |= 0x08;
      out.push(flags);

      if ((flags & 0x04) !== 0) {
        writeVarUint(e.amount, out);
      }

      if ((flags & 0x08) !== 0) {
        const idBytes = encoder.encode(e.id);
        writeVarUint(idBytes.length, out);
        for (const b of idBytes) out.push(b);
      } else {
        const deviceIndex = deviceKeyToIndex.get(e.parsed.deviceKey);
        writeVarUint(deviceIndex, out);
        writeVarUint(e.parsed.seq, out);
      }
    }

    // optional extension: action codes ("ac", v2)
    const rawActionCodes =
      wallet && Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];
    if (rawActionCodes.length) {
      let actionCodes = rawActionCodes;
      try {
        const api = window.dbWalletActionCodes || null;
        if (api && typeof api.normalizeActionCodes === "function") {
          actionCodes = api.normalizeActionCodes(rawActionCodes);
        }
      } catch (e) {
        // ignore
      }

      out.push(97, 99); // "ac"
      writeVarUint(2, out);
      writeVarUint(actionCodes.length, out);
      for (const c of actionCodes) {
        const id = c && typeof c.id === "string" ? c.id : "";
        const label = c && typeof c.label === "string" ? c.label : "";
        const key = c && typeof c.key === "string" ? c.key : "";
        const amountRaw =
          c && typeof c.amount === "number"
            ? c.amount
            : parseInt(c && c.amount, 10);
        const amount =
          typeof amountRaw === "number" && isFinite(amountRaw)
            ? Math.max(1, Math.round(amountRaw))
            : 1;
        const createdAtRaw =
          c && typeof c.createdAt === "number" ? c.createdAt : 0;
        const createdAt =
          typeof createdAtRaw === "number" &&
          isFinite(createdAtRaw) &&
          createdAtRaw > 0
            ? Math.floor(createdAtRaw)
            : Date.now();
        const updatedAtRaw =
          c && typeof c.updatedAt === "number" ? c.updatedAt : 0;
        const updatedAt =
          typeof updatedAtRaw === "number" &&
          isFinite(updatedAtRaw) &&
          updatedAtRaw > 0
            ? Math.floor(updatedAtRaw)
            : createdAt;

        const idBytes = encoder.encode(id);
        writeVarUint(idBytes.length, out);
        for (const b of idBytes) out.push(b);

        const labelBytes = encoder.encode(label);
        writeVarUint(labelBytes.length, out);
        for (const b of labelBytes) out.push(b);

        writeVarUint(amount, out);

        const keyBytes = encoder.encode(key);
        writeVarUint(keyBytes.length, out);
        for (const b of keyBytes) out.push(b);

        writeVarUint(createdAt, out);
        writeVarUint(updatedAt, out);

        const type = c && typeof c.type === "string" ? c.type : "";
        writeVarUint(type === "d" ? 1 : 0, out);
      }
    }

    // optional extension: sync peer device id ("sp", v1)
    const deviceId = typeof getDeviceKey === "function" ? getDeviceKey() : "";
    if (deviceId) {
      out.push(115, 112); // "sp"
      writeVarUint(1, out);
      const bytes = encoder.encode(deviceId);
      writeVarUint(bytes.length, out);
      for (const b of bytes) out.push(b);
    }

    // optional extension: device list ("dv", v1)
    try {
      const devices =
        typeof ensureWalletDevices === "function"
          ? ensureWalletDevices(wallet)
          : [];
      if (devices && devices.length) {
        out.push(100, 118); // "dv"
        writeVarUint(1, out);
        writeVarUint(devices.length, out);
        for (const d of devices) {
          const deviceKey =
            d && typeof d.deviceKey === "string" ? d.deviceKey : "";
          const keyBytes = encoder.encode(deviceKey);
          writeVarUint(keyBytes.length, out);
          for (const b of keyBytes) out.push(b);

          const sym =
            d &&
            typeof d.symbol === "string" &&
            DEVICE_SYMBOLS.includes(d.symbol)
              ? d.symbol
              : "";
          const symCode = sym ? DEVICE_SYMBOLS.indexOf(sym) + 1 : 0;
          writeVarUint(symCode, out);

          const lastSeenAt =
            d &&
            typeof d.lastSeenAt === "number" &&
            Number.isFinite(d.lastSeenAt)
              ? Math.max(0, Math.floor(d.lastSeenAt))
              : 0;
          writeVarUint(lastSeenAt, out);
        }
      }
    } catch (e) {
      // ignore
    }

    // optional extension: tombstones ("xt", v1)
    if (tombstones.length) {
      out.push(120, 116); // "xt"
      writeVarUint(1, out);
      writeVarUint(tombstones.length, out);
      for (const t of tombstones) {
        const idBytes = encoder.encode(t.id);
        writeVarUint(idBytes.length, out);
        for (const b of idBytes) out.push(b);

        const refBytes = encoder.encode(t.ref);
        writeVarUint(refBytes.length, out);
        for (const b of refBytes) out.push(b);

        writeVarUint(t.tsMs, out);
      }
    }

    return new Uint8Array(out);
  }

  function resolveUserIdForImport(remote) {
    const remoteWalletId =
      typeof remote.walletId === "string" ? remote.walletId : "";
    const remoteUserId =
      typeof remote.userId === "string" && remote.userId
        ? remote.userId
        : "user-" + randomId();

    let userId = remoteUserId;
    if (remoteWalletId) {
      const knownUserId = findUserIdByWalletId(remoteWalletId);
      if (knownUserId) {
        userId = knownUserId;
      } else if (userIdExists(userId)) {
        const existingWalletId = walletIdForUserId(userId);
        if (existingWalletId !== remoteWalletId) {
          const suffix = remoteWalletId.slice(0, 4).toLowerCase();
          userId = makeUniqueUserId(`${userId}-${suffix}`);
        }
      }
    }
    return ensureNonReservedUserId(userId);
  }

  function applyImportedTheme(remote, options) {
    if (remote && remote.theme) {
      const name = remote.theme;
      const applyTheme =
        options && typeof options.applyTheme === "function"
          ? options.applyTheme
          : applyThemeRaw;
      applyTheme(name);
    }
  }

  function buildImportedWallet(remote) {
    const userId = resolveUserIdForImport(remote);
    const local = loadWallet(userId);
    const mergedEvents = mergeEvents(
      local.events,
      Array.isArray(remote.events) ? remote.events : [],
    );
    try {
      const api = window.dbWalletActionCodes || null;
      if (api && typeof api.mergeActionCodes === "function") {
        local.actionCodes = api.mergeActionCodes(
          local.actionCodes,
          remote && remote.actionCodes,
        );
      } else if (remote && Array.isArray(remote.actionCodes)) {
        local.actionCodes = remote.actionCodes;
      }
    } catch (e) {
      // ignore
    }
    local.walletId =
      (typeof remote.walletId === "string" && remote.walletId
        ? remote.walletId
        : null) ||
      local.walletId ||
      randomWalletId();
    local.v =
      typeof remote.v === "number" && Number.isFinite(remote.v) && remote.v > 0
        ? remote.v
        : local.v || 1;
    local.events = mergedEvents;
    const allCompact = local.events.every((e) => {
      const id = e && typeof e.id === "string" ? e.id : "";
      return !!parseCompactEventId(id);
    });
    local.v = allCompact ? (local.v < 2 ? 2 : local.v) : 1;

    // sync status tracking (local-only)
    try {
      if (
        !local.syncPeers ||
        typeof local.syncPeers !== "object" ||
        Array.isArray(local.syncPeers)
      ) {
        local.syncPeers = {};
      }

      const peerKeyRaw =
        remote && typeof remote.deviceId === "string" && !("seq" in remote) // only V2 "sp" extension, not JSON export field
          ? remote.deviceId.trim()
          : "";
      let peerKey = peerKeyRaw;
      if (!peerKey) {
        const wid =
          remote && typeof remote.walletId === "string" ? remote.walletId : "";
        peerKey = wid ? "remote-" + wid.slice(0, 8) : "remote-unknown";
      }

      const existing = local.syncPeers[peerKey];
      const peer =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? existing
          : {};

      if (!peer.label) {
        peer.label = "Remote";
      }

      const remoteEvents = Array.isArray(remote && remote.events)
        ? remote.events
        : [];
      const peerEventCount = remoteEvents.length;

      peer.updatedAt = Date.now();
      peer.peerEventCount = peerEventCount;
      peer.commonEventCount = local.events.length;
      local.syncPeers[peerKey] = peer;
    } catch (e) {
      // ignore
    }

    // device list (synced): merge + normalize + max 6
    try {
      if (typeof mergeWalletDevices === "function") {
        mergeWalletDevices(local, remote && remote.devices);
      }
    } catch (e) {
      // ignore
    }

    return { userId, wallet: local };
  }

  function importRemoteWallet(remote, options) {
    const { userId, wallet } = buildImportedWallet(remote);
    ensureDeviceSeq(wallet);
    saveWallet(wallet);
    applyImportedTheme(remote, options);
    window.location.hash = "#" + userId;
    alert("Getränkedaten importiert ✅");
    return userId;
  }

  function newEvent(wallet, type, n) {
    return {
      id: nextEventId(wallet),
      t: type, // 'd' = drink, 's' = Korrektur/Rückgängig, 'p' = bezahlt, 'g' = Guthaben
      n: typeof n === "number" ? n : undefined,
      ts: Date.now(),
    };
  }

  async function tryImportFromHash(options) {
    const hash = window.location.hash.slice(1);
    if (!hash) return { userId: null, redirectedToPreview: false };

    const importPreview = window.dbWalletImportPreview || null;
    const chooseMode =
      importPreview && typeof importPreview.chooseImportMode === "function"
        ? importPreview.chooseImportMode
        : null;
    const openPreview =
      importPreview && typeof importPreview.openPreview === "function"
        ? importPreview.openPreview
        : null;

    async function handleImportChoice(remote, label) {
      let mode = "persist";
      if (chooseMode) {
        mode = await chooseMode({
          header: label || "Import erkannt",
        });
        if (!mode) {
          window.location.href = "index.html";
          return { userId: null, redirectedToPreview: true };
        }
      }

      if (mode === "preview" && openPreview) {
        const built = buildImportedWallet(remote);
        const theme =
          remote && typeof remote.theme === "string" ? remote.theme : "";
        const ok = openPreview({
          source: "hash",
          wallet: built.wallet,
          theme,
        });
        if (ok) {
          return { userId: null, redirectedToPreview: true };
        }
        window.location.href = "index.html";
        return { userId: null, redirectedToPreview: true };
      }

      return {
        userId: importRemoteWallet(remote, options),
        redirectedToPreview: false,
      };
    }

    try {
      if (hash.startsWith("ac:")) {
        const activeUserId =
          options && typeof options.returnToUserId === "string"
            ? options.returnToUserId
            : "";
        const api = window.dbWalletActionCodes || null;
        const payload =
          api && typeof api.decodeActionHash === "function"
            ? api.decodeActionHash(hash)
            : safeParse(base64UrlDecode(hash.slice(3)));
        if (!payload || typeof payload !== "object") {
          throw new Error("Invalid action payload");
        }

        const payloadWalletId =
          typeof payload.walletId === "string" ? payload.walletId : "";
        const codeId = typeof payload.codeId === "string" ? payload.codeId : "";
        const key = typeof payload.key === "string" ? payload.key : "";
        if (!payloadWalletId) {
          alert(
            "Action Code ungültig: Ziel-Wallet fehlt.\nBuchung verweigert.",
          );
          if (activeUserId) {
            window.location.hash = "#" + activeUserId;
            return { userId: activeUserId, redirectedToPreview: false };
          }
          window.location.href = "index.html";
          return { userId: null, redirectedToPreview: true };
        }
        if (!codeId || !key) {
          alert("Action Code ungültig (Daten fehlen).\nBuchung verweigert.");
          if (activeUserId) {
            window.location.hash = "#" + activeUserId;
            return { userId: activeUserId, redirectedToPreview: false };
          }
          window.location.href = "index.html";
          return { userId: null, redirectedToPreview: true };
        }

        const targetUserId = findUserIdByWalletId(payloadWalletId);
        if (!targetUserId) {
          const shouldGoHome = window.confirm(
            "Dieses Wallet ist auf diesem Gerät noch nicht vorhanden.\nVor dem Buchen muss es importiert werden.\nJetzt zur Startseite wechseln?",
          );
          if (!shouldGoHome) {
            if (activeUserId) {
              window.location.hash = "#" + activeUserId;
              return { userId: activeUserId, redirectedToPreview: false };
            }
            return { userId: null, redirectedToPreview: false };
          }
          try {
            if (typeof sessionStorage !== "undefined" && sessionStorage) {
              sessionStorage.setItem(
                "db-wallet:pending-walletId",
                payloadWalletId,
              );
            }
          } catch (e) {
            // ignore
          }
          window.location.href = "index.html";
          return { userId: null, redirectedToPreview: true };
        }

        if (activeUserId && targetUserId !== activeUserId) {
          const shouldSwitch = window.confirm(
            `Action Code gehört zu einem anderen Profil.\nZiel: ${targetUserId}\nAktuell: ${activeUserId}\nZu diesem Profil wechseln und buchen?`,
          );
          if (!shouldSwitch) {
            window.location.hash = "#" + activeUserId;
            return { userId: activeUserId, redirectedToPreview: false };
          }
        }

        const wallet = loadWallet(targetUserId);
        ensureDeviceSeq(wallet);

        try {
          if (api && typeof api.ensureWalletActionCodes === "function") {
            const res = api.ensureWalletActionCodes(wallet);
            if (res && res.changed) saveWallet(wallet);
          }
        } catch (e) {
          // ignore
        }

        const codes = Array.isArray(wallet.actionCodes)
          ? wallet.actionCodes
          : [];
        const match = codeId && codes.find((c) => c && c.id === codeId);
        if (!match) {
          alert(
            "Action Code ist unbekannt oder nicht mehr vorhanden.\nBuchung verweigert.",
          );
          window.location.hash = "#" + targetUserId;
          return { userId: targetUserId, redirectedToPreview: false };
        }

        const matchKey =
          match && typeof match.key === "string" ? match.key : "";
        if (!matchKey || matchKey !== key) {
          alert(
            "Action Code wurde erneuert.\nBitte den neuen QR-Code nutzen.\nBuchung verweigert.",
          );
          window.location.hash = "#" + targetUserId;
          return { userId: targetUserId, redirectedToPreview: false };
        }

        const amount =
          api && typeof api.normalizeAmount === "function"
            ? api.normalizeAmount(match.amount)
            : (() => {
                const n = parseInt(match.amount, 10);
                return isNaN(n) || n <= 0 ? 1 : n;
              })();

        const normalizeType = (v) => (v === "d" || v === "g" ? v : null);
        const type =
          normalizeType(payload.type) || normalizeType(match.type) || "g";

        wallet.events.push(newEvent(wallet, type === "d" ? "d" : "g", amount));
        saveWallet(wallet);
        window.location.hash = "#" + targetUserId;
        alert(
          type === "d"
            ? `${amount} Getränk(e) getrunken gebucht ✅`
            : `Guthaben +${amount} Getränke gebucht ✅`,
        );
        return { userId: targetUserId, redirectedToPreview: false };
      }
      if (hash.startsWith("i2u:")) {
        const raw = base64UrlDecodeBytes(hash.slice(4));
        const remote = decodeImportV2Bytes(raw);
        return await handleImportChoice(remote, "QR-Import (kurz)");
      }
      if (hash.startsWith("i2:")) {
        const compressed = base64UrlDecodeBytes(hash.slice(3));
        const raw = await gzipDecompress(compressed);
        const remote = decodeImportV2Bytes(raw);
        return await handleImportChoice(remote, "QR-Import (kurz)");
      }
      if (hash.startsWith("import:")) {
        const payload = base64UrlDecode(hash.slice(7));
        const remote = safeParse(payload);
        if (!remote || typeof remote !== "object") {
          throw new Error("Invalid import payload");
        }
        return await handleImportChoice(remote, "Import-Link erkannt");
      }
      return { userId: null, redirectedToPreview: false };
    } catch (e) {
      const msg =
        hash.startsWith("i2:") && typeof DecompressionStream === "undefined"
          ? "QR-Import (kurz) wird in diesem Browser nicht unterstützt.\nBitte nutze den klassischen Export-Link oder JSON."
          : "Import fehlgeschlagen ❌";
      alert(msg);
      window.location.hash = "";
      return { userId: null, redirectedToPreview: false };
    }
  }

  window.dbWalletImportV2 = {
    writeVarUint,
    readVarUint,
    fnv1a64,
    hash53,
    legacyIdToV2Id,
    mergeEvents,
    themeIndexFromName,
    themeNameFromIndex,
    encodeImportV2Bytes,
    decodeImportV2Bytes,
    resolveUserIdForImport,
    applyImportedTheme,
    buildImportedWallet,
    importRemoteWallet,
    tryImportFromHash,
  };
})();
