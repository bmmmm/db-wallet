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
    hash53,
    extractLegacyDeviceKey,
    cmpEventId,
    formatCompactEventId,
    normalizeUserId,
  } = helpers;

  // Point the URL at `userId` (or drop the fragment for "") without a history
  // entry or a hashchange (P2.1): the caller routes exactly once itself.
  // Import failures carry a machine-readable `code` (P2.3); tryImportFromHash
  // maps it through IMPORT_ERROR_MESSAGES instead of matching message text.
  function importError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  const IMPORT_ERROR_MESSAGES = {
    checksum:
      "Import beschädigt ❌ — die Prüfsumme stimmt nicht (Link unvollständig oder verändert).\nBitte einen frischen Export-Link/QR vom Quellgerät nutzen.",
    truncated:
      "Import fehlgeschlagen ❌ — die Daten sind unvollständig (Link abgeschnitten?).\nBitte einen frischen Export-Link/QR vom Quellgerät nutzen.",
    corrupt:
      "Import fehlgeschlagen ❌ — die Daten sind beschädigt.\nBitte einen frischen Export-Link/QR vom Quellgerät nutzen.",
    "too-large":
      "Import abgebrochen: Die Daten sind zu groß.\nBitte einen frischen Export-Link/QR vom Quellgerät nutzen.",
    "unsupported-version":
      "Import fehlgeschlagen ❌ — die Daten stammen aus einer neueren App-Version.\nBitte diese App aktualisieren.",
    "unsupported-browser":
      "QR-Import (kurz) wird in diesem Browser nicht unterstützt.\nBitte nutze den klassischen Export-Link oder JSON.",
    unknown: "Import fehlgeschlagen ❌",
  };

  function importErrorCode(e) {
    const code = e && typeof e.code === "string" ? e.code : "";
    return Object.prototype.hasOwnProperty.call(IMPORT_ERROR_MESSAGES, code)
      ? code
      : "unknown";
  }

  // Re-throw anything a decode step raised without a code as corrupt data
  // (atob, DecompressionStream, TextDecoder errors on garbage input).
  function asImportError(e, fallbackCode) {
    if (e && typeof e.code === "string" && e.code) return e;
    return importError(fallbackCode, String((e && e.message) || e || ""));
  }

  function returnUserIdOf(options) {
    return options && typeof options.returnToUserId === "string"
      ? options.returnToUserId
      : "";
  }

  function replaceHash(userId) {
    const target = String(userId || "");
    if (helpers.replaceHashSilently && helpers.replaceHashSilently(target)) return;
    window.location.hash = target ? "#" + target : "";
  }

  const {
    getDeviceKey,
    parseCompactEventId,
    ensureWalletDevices,
    mergeWalletDevices,
    ensureDeviceSeq,
    newEvent,
    appendEvents,
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

  const DEVICE_SYMBOLS = helpers.DEVICE_SYMBOLS;

  function legacyIdToV2Id(legacyId) {
    if (!legacyId || typeof legacyId !== "string") return null;
    if (!legacyId.includes("-")) return null;
    // A compact v2 id is never legacy, even when its base64url device key
    // contains "-" (~12 % of keys): no alias, and no BigInt hash per event on
    // every saveWallet merge (P2.4).
    if (parseCompactEventId(legacyId)) return null;
    const device = extractLegacyDeviceKey(legacyId);
    const seq = hash53(legacyId);
    return `${device}.${seq.toString(36)}`;
  }

  function mergeEvents(localEvents, remoteEvents) {
    const merged = [];
    const seen = new Set();
    let dropped = 0;

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
      else if (e) dropped++;
    }
    for (const e of remoteEvents || []) {
      if (!e || typeof e.id !== "string" || !e.id) {
        if (e) dropped++;
        continue;
      }
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

    // Return in canonical order (ts, then cmpEventId) so the persisted log
    // matches the balance fold — consumers re-sort anyway, but this removes the
    // latent trap and satisfies the ordering invariant.
    if (helpers && typeof helpers.compareEventsByTime === "function") {
      merged.sort(helpers.compareEventsByTime);
    }
    // Expose how many id-less events were skipped so the import flow can warn
    // about a partial import instead of reporting clean success. Non-enumerable
    // so it never serializes into the persisted wallet.
    if (dropped > 0) {
      try {
        Object.defineProperty(merged, "_droppedEventCount", {
          value: dropped,
          enumerable: false,
        });
      } catch (e) {
        // ignore
      }
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
        throw importError("truncated", "Truncated varint");
      }
      const b = bytes[offset++];
      result += (b & 0x7f) * multiplier;
      if (result > Number.MAX_SAFE_INTEGER) {
        throw importError("corrupt", "Varint too large");
      }
      if ((b & 0x80) === 0) break;
      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        throw importError("corrupt", "Varint too large");
      }
    }
    return [result, offset];
  }

  // Reject over-reads instead of letting Uint8Array.slice silently clamp to the
  // buffer end (which advances the cursor past the data and yields truncated,
  // silently-corrupted strings/ids).
  function sliceChecked(bytes, offset, len) {
    if (typeof len !== "number" || len < 0 || offset + len > bytes.length) {
      throw importError("truncated", "Truncated payload");
    }
    return bytes.slice(offset, offset + len);
  }

  // Shared UTF-8 codecs for the length-prefixed string primitives below. The
  // decoder is fatal so a corrupt/crafted payload throws instead of yielding
  // replacement characters.
  const stringEncoder = new TextEncoder();
  const stringDecoder = new TextDecoder("utf-8", { fatal: true });

  // Length-prefixed string primitives: a varint byte-length followed by the
  // UTF-8 bytes. writeString mirrors the (encode + writeVarUint(len) + push)
  // pattern that repeated across the encoder; readString mirrors the inverse
  // (readVarUint + sliceChecked-bounded decode). Byte layout is unchanged.
  function writeString(str, out) {
    const bytes = stringEncoder.encode(str);
    writeVarUint(bytes.length, out);
    for (const b of bytes) out.push(b);
  }

  function readString(bytes, offset) {
    const [len, next] = readVarUint(bytes, offset);
    const str = stringDecoder.decode(sliceChecked(bytes, next, len));
    return [str, next + len];
  }

  // Length-prefixed base64url-decoded byte blob (walletId). Separate from
  // writeString because the walletId is stored as raw bytes, not UTF-8 text.
  function writeBytesBlob(byteArray, out) {
    writeVarUint(byteArray.length, out);
    for (const b of byteArray) out.push(b);
  }

  // Bound a decoded count so a corrupt/crafted payload can't produce absurd
  // values. Far above any real drink count, so legitimate data is untouched.
  // One shared ceiling (wallet-helpers) for codec, storage and input paths.
  const MAX_DECODED_AMOUNT = helpers.MAX_EVENT_AMOUNT;

  // Encodes one action-code record (v2 layout: id, label, amount, key,
  // createdAt, updatedAt, type). Shared by the "ac" (local) and "gc" (global)
  // extension blocks so both stay byte-compatible. The key is written verbatim —
  // the export is a bearer credential by design.
  function writeActionCodeEntry(c, out) {
    const id = c && typeof c.id === "string" ? c.id : "";
    const label = c && typeof c.label === "string" ? c.label : "";
    const key = c && typeof c.key === "string" ? c.key : "";
    const amountRaw =
      c && typeof c.amount === "number" ? c.amount : parseInt(c && c.amount, 10);
    const amount =
      typeof amountRaw === "number" && isFinite(amountRaw)
        ? Math.max(1, Math.round(amountRaw))
        : 1;
    const createdAtRaw = c && typeof c.createdAt === "number" ? c.createdAt : 0;
    const createdAt =
      typeof createdAtRaw === "number" &&
      isFinite(createdAtRaw) &&
      createdAtRaw > 0
        ? Math.floor(createdAtRaw)
        : Date.now();
    const updatedAtRaw = c && typeof c.updatedAt === "number" ? c.updatedAt : 0;
    const updatedAt =
      typeof updatedAtRaw === "number" &&
      isFinite(updatedAtRaw) &&
      updatedAtRaw > 0
        ? Math.floor(updatedAtRaw)
        : createdAt;

    writeString(id, out);
    writeString(label, out);
    writeVarUint(amount, out);
    writeString(key, out);
    writeVarUint(createdAt, out);
    writeVarUint(updatedAt, out);
    const type = c && typeof c.type === "string" ? c.type : "";
    writeVarUint(type === "d" ? 1 : 0, out);
  }

  // Inverse of writeActionCodeEntry. `hasType` reads the trailing type byte
  // (ac v2 / gc v1); when false (ac v1) the type defaults to "g".
  function readActionCodeEntry(bytes, offset, hasType) {
    let id, label, key, amount, createdAt, updatedAt;
    [id, offset] = readString(bytes, offset);
    [label, offset] = readString(bytes, offset);
    [amount, offset] = readVarUint(bytes, offset);
    [key, offset] = readString(bytes, offset);
    [createdAt, offset] = readVarUint(bytes, offset);
    [updatedAt, offset] = readVarUint(bytes, offset);
    let type = "g";
    if (hasType) {
      let typeCode;
      [typeCode, offset] = readVarUint(bytes, offset);
      type = typeCode === 1 ? "d" : "g";
    }
    return [
      {
        id,
        label,
        amount: Math.min(amount, MAX_DECODED_AMOUNT),
        key,
        createdAt,
        updatedAt,
        type,
      },
      offset,
    ];
  }

  function themeIndexFromName(name) {
    const canonical = canonicalThemeName(name);
    const idx = THEME_NAMES.indexOf(canonical);
    return idx >= 0 ? idx : 255;
  }

  function themeNameFromIndex(idx) {
    return idx >= 0 && idx < THEME_NAMES.length ? THEME_NAMES[idx] : null;
  }

  // --- decodeImportV2Bytes internal helpers ---

  // Reads the fixed header fields up to (but not including) the events section.
  // Returns { themeIdx, walletV, walletId, userId, deviceKeys, baseTsMin, offset }.
  function decodeV2Header(bytes, startOffset) {
    let offset = startOffset;
    const themeIdx = bytes[offset++];
    const [walletV, o1] = readVarUint(bytes, offset);
    offset = o1;

    const [walletIdLen, o2] = readVarUint(bytes, offset);
    offset = o2;
    const walletIdBytes = sliceChecked(bytes, offset, walletIdLen);
    offset += walletIdLen;
    const walletId = base64UrlEncodeBytes(walletIdBytes);

    let userId;
    [userId, offset] = readString(bytes, offset);

    const [deviceCount, o4] = readVarUint(bytes, offset);
    offset = o4;
    const deviceKeys = [];
    for (let i = 0; i < deviceCount; i++) {
      let key;
      [key, offset] = readString(bytes, offset);
      deviceKeys.push(key);
    }

    const [baseTsMin, o6] = readVarUint(bytes, offset);
    offset = o6;

    return { themeIdx, walletV, walletId, userId, deviceKeys, baseTsMin, offset };
  }

  // Reads the events section and pushes decoded events into out.events.
  // Returns the new offset after consuming all event bytes.
  function decodeV2Events(bytes, deviceKeys, baseTsMin, startOffset) {
    let offset = startOffset;
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
        amount = Math.min(n, MAX_DECODED_AMOUNT);
      }

      let id = "";
      if (idIsString) {
        [id, offset] = readString(bytes, offset);
      } else {
        const [deviceIndex, o10] = readVarUint(bytes, offset);
        offset = o10;
        const [seq, o11] = readVarUint(bytes, offset);
        offset = o11;
        // Reject an out-of-range device index instead of silently mis-attributing
        // the event to a bogus "dev" device.
        if (deviceIndex >= deviceKeys.length) {
          throw importError("corrupt", "Invalid device index");
        }
        const deviceKey = deviceKeys[deviceIndex];
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

      const ts = tsMin * 60000 + withinMinute;
      if (ts > Number.MAX_SAFE_INTEGER) {
        throw importError("corrupt", "Timestamp out of range");
      }
      const ev = {
        id,
        t,
        ts,
      };
      if (t !== "p") {
        ev.n = amount;
      }
      events.push(ev);
    }

    return { events, offset };
  }

  // Reads the optional trailing extension blocks ("ac", "gc", "sp", "dv", "xt",
  // "se") and mutates decoded in place. Tolerates parse errors for forward-compat.
  function decodeV2Extensions(bytes, startOffset, decoded) {
    let offset = startOffset;
    try {
      while (offset + 1 < bytes.length) {
        if (
          bytes[offset] === 97 && // "a"
          bytes[offset + 1] === 99 // "c"
        ) {
          offset += 2;
          const [acVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          // Unknown version: stop extension parsing rather than continuing with a
          // desynced cursor (blocks have no length prefix to skip over).
          if (acVersion !== 1 && acVersion !== 2) break;
          const [count, o9] = readVarUint(bytes, offset);
          offset = o9;
          const actionCodes = [];
          for (let i = 0; i < count; i++) {
            let code;
            [code, offset] = readActionCodeEntry(bytes, offset, acVersion === 2);
            actionCodes.push(code);
          }
          decoded.actionCodes = actionCodes;
          continue;
        }

        if (
          bytes[offset] === 103 && // "g"
          bytes[offset + 1] === 99 // "c"
        ) {
          offset += 2;
          const [gcVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (gcVersion !== 1) break;
          const [count, o9] = readVarUint(bytes, offset);
          offset = o9;
          const globalActionCodes = [];
          for (let i = 0; i < count; i++) {
            let code;
            [code, offset] = readActionCodeEntry(bytes, offset, true);
            // Global codes carry no key. Exports written before P1.3 contain an
            // invented random key here (and lost the scope); drop it and
            // restore the scope so old exports import as proper global codes.
            delete code.key;
            code.scope = "global";
            globalActionCodes.push(code);
          }
          decoded.globalActionCodes = globalActionCodes;
          continue;
        }

        if (
          bytes[offset] === 115 && // "s"
          bytes[offset + 1] === 112 // "p"
        ) {
          offset += 2;
          const [spVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (spVersion !== 1) break;
          let deviceId;
          [deviceId, offset] = readString(bytes, offset);
          if (deviceId) decoded.deviceId = deviceId;
          continue;
        }

        if (
          bytes[offset] === 100 && // "d"
          bytes[offset + 1] === 118 // "v"
        ) {
          offset += 2;
          const [dvVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (dvVersion !== 1) break;
          const [count, o9] = readVarUint(bytes, offset);
          offset = o9;
          const devices = [];
          for (let i = 0; i < count; i++) {
            let deviceKey;
            [deviceKey, offset] = readString(bytes, offset);

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
          continue;
        }

        if (
          bytes[offset] === 120 && // "x"
          bytes[offset + 1] === 116 // "t"
        ) {
          offset += 2;
          const [xtVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (xtVersion !== 1) break;
          const [count, o9] = readVarUint(bytes, offset);
          offset = o9;
          for (let i = 0; i < count; i++) {
            let id, ref;
            [id, offset] = readString(bytes, offset);
            [ref, offset] = readString(bytes, offset);

            const [tsMs, o12] = readVarUint(bytes, offset);
            offset = o12;

            // Skip self-referential tombstones (a tombstone deleting itself is
            // meaningless) — cheap guard against malformed/crafted xt entries.
            if (id && ref && id !== ref) {
              decoded.events.push({
                id,
                t: "x",
                ref,
                ts: tsMs,
              });
            }
          }
          continue;
        }

        if (
          bytes[offset] === 115 && // "s"
          bytes[offset + 1] === 101 // "e"
        ) {
          offset += 2;
          const [seVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (seVersion !== 1) break;
          const [count, o9] = readVarUint(bytes, offset);
          offset = o9;
          const supById = new Map();
          for (let i = 0; i < count; i++) {
            let id, sup;
            [id, offset] = readString(bytes, offset);
            [sup, offset] = readString(bytes, offset);

            if (id && sup && id !== sup) supById.set(id, sup);
          }
          if (supById.size && Array.isArray(decoded.events)) {
            for (const ev of decoded.events) {
              if (ev && ev.t !== "x" && typeof ev.id === "string" && supById.has(ev.id)) {
                ev.supersedes = supById.get(ev.id);
              }
            }
          }
          continue;
        }

        if (
          bytes[offset] === 99 && // "c"
          bytes[offset + 1] === 107 // "k"
        ) {
          // Just consume the trailer here; the checksum is verified independently
          // of this cursor in decodeImportV2Bytes (a corrupt upstream tag/version
          // byte would make this loop break before ever reaching ck).
          offset += 2;
          const [ckVersion, o8] = readVarUint(bytes, offset);
          offset = o8;
          if (ckVersion !== 1) break;
          offset += 4;
          continue;
        }

        break;
      }
    } catch (e) {
      console.warn("db-wallet: import-v2 extension parse failed", e);
      // Flag the loss so the import flow can warn the user that some action
      // codes / devices / tombstones were dropped, instead of reporting a clean
      // success. Dropped tombstones in particular resurrect deleted events.
      if (decoded && typeof decoded === "object") {
        decoded._extWarning = true;
      }
    }
  }

  function decodeImportV2Bytes(bytes) {
    if (
      bytes.length < 5 ||
      bytes[0] !== 100 || // d
      bytes[1] !== 98 || // b
      bytes[2] !== 119 // w
    ) {
      throw importError("corrupt", "Invalid v2 payload");
    }
    if (bytes[3] !== 2) {
      // Magic matches but the codec version is newer than this build understands.
      throw importError(
        "unsupported-version",
        "Unsupported codec version " + bytes[3],
      );
    }

    // Verify the integrity checksum INDEPENDENTLY of the extension-block cursor:
    // if the payload ends with a "ck" trailer (99,107, version=1, 4 checksum
    // bytes), fnv1a64 over everything before it must match. Doing it here — not
    // inside the tolerant extension loop — means a corrupt upstream tag/version
    // byte (which would make that loop break early) can't slip a corrupt payload
    // through. Payloads without a ck trailer (older encoders) skip the check.
    if (bytes.length >= 7) {
      const tlen = bytes.length;
      if (
        bytes[tlen - 7] === 99 &&
        bytes[tlen - 6] === 107 &&
        bytes[tlen - 5] === 1 &&
        helpers &&
        typeof helpers.fnv1a64 === "function"
      ) {
        const stored =
          ((bytes[tlen - 4] << 24) |
            (bytes[tlen - 3] << 16) |
            (bytes[tlen - 2] << 8) |
            bytes[tlen - 1]) >>>
          0;
        const actual = Number(
          helpers.fnv1a64(bytes.subarray(0, tlen - 7)) & 0xffffffffn,
        );
        if (stored !== actual) {
          throw importError("checksum", "Import checksum mismatch");
        }
      }
    }

    const header = decodeV2Header(bytes, 4);
    const { themeIdx, walletV, walletId, userId, deviceKeys, baseTsMin } = header;

    const evResult = decodeV2Events(bytes, deviceKeys, baseTsMin, header.offset);
    const { events } = evResult;

    const theme = themeNameFromIndex(themeIdx);
    const decoded = {
      userId: userId || "user-" + randomId(),
      walletId,
      v: walletV || 1,
      events,
      theme,
    };

    // optional extensions:
    //  - tombstones ("xt", v1)
    //  - action codes ("ac", v1/v2)
    //  - sync peer device id ("sp", v1)
    //  - device list ("dv", v1)
    //  - supersedes links ("se", v1)
    //  - global action codes ("gc", v1)
    //  - integrity checksum ("ck", v1)
    if (evResult.offset < bytes.length) {
      decodeV2Extensions(bytes, evResult.offset, decoded);
    }

    return decoded;
  }

  function encodeImportV2Bytes(wallet, themeName) {
    const out = [];

    out.push(100, 98, 119, 2); // "dbw" + codec v2
    out.push(themeIndexFromName(themeName));
    writeVarUint(wallet && wallet.v ? wallet.v : 1, out);

    const walletIdStr =
      wallet && typeof wallet.walletId === "string"
        ? wallet.walletId
        : randomWalletId();
    writeBytesBlob(base64UrlDecodeBytes(walletIdStr), out);

    const userIdStr =
      wallet && typeof wallet.userId === "string"
        ? wallet.userId
        : "user-" + randomId();
    writeString(userIdStr, out);

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
        // Clamp to >= 0: a negative ts would make writeVarUint (unsigned) throw
        // and permanently brick every export.
        const tsMs =
          typeof e.ts === "number" && Number.isFinite(e.ts) && e.ts > 0
            ? Math.floor(e.ts)
            : 0;
        if (id && ref) {
          tombstones.push({ id, ref, tsMs });
        }
        continue;
      }
      if (typeCodeMap[t] === undefined) continue;
      const tsMs =
        typeof e.ts === "number" && Number.isFinite(e.ts) && e.ts > 0
          ? Math.floor(e.ts)
          : 0;
      const tsMin = Math.floor(tsMs / 60000);
      const id = typeof e.id === "string" && e.id ? e.id : "";
      if (!id) continue;

      // Only take the compact (device-index + seq) path when the id round-trips
      // EXACTLY. A non-canonical seq like "dev.01" parses to seq 1 but the
      // decoder rebuilds it as "dev.1", silently rewriting the id and breaking
      // dedup / supersedes matching. When it doesn't round-trip, fall through to
      // the verbatim string-id path below (parsed stays null).
      const parsedRaw = parseCompactEventId(id);
      const parsed =
        parsedRaw &&
        formatCompactEventId(parsedRaw.deviceKey, parsedRaw.seq) === id
          ? parsedRaw
          : null;
      if (parsed && !deviceKeyToIndex.has(parsed.deviceKey)) {
        deviceKeyToIndex.set(parsed.deviceKey, deviceKeys.length);
        deviceKeys.push(parsed.deviceKey);
      }

      let amount = 1;
      if (t !== "p") {
        const n =
          typeof e.n === "number" && isFinite(e.n) ? Math.round(e.n) : 1;
        // Clamp like the decoder does so a poisoned/absurd n can never make
        // writeVarUint throw, which would permanently brick re-export.
        amount = n > 0 ? Math.min(n, MAX_DECODED_AMOUNT) : 1;
      }

      const supersedes =
        typeof e.supersedes === "string" && e.supersedes ? e.supersedes : "";

      events.push({
        tsMin,
        tsMs,
        typeCode: typeCodeMap[t],
        amount,
        id,
        parsed,
        supersedes,
      });
    }

    // Order events exactly as the balance fold does (computeSummary: ts then
    // canonical id). The decoder rebuilds sub-minute order from payload position,
    // so any divergence here would silently reorder same-minute events on import
    // and could flip paid/unpaid. (Sorting by tsMs keeps tsMin non-decreasing, so
    // the minute deltas written below stay >= 0.)
    events.sort((a, b) => {
      if (a.tsMs !== b.tsMs) return a.tsMs - b.tsMs;
      return cmpEventId(a.id, b.id);
    });

    writeVarUint(deviceKeys.length, out);
    for (const key of deviceKeys) {
      writeString(key, out);
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
        writeString(e.id, out);
      } else {
        const deviceIndex = deviceKeyToIndex.get(e.parsed.deviceKey);
        writeVarUint(deviceIndex, out);
        writeVarUint(e.parsed.seq, out);
      }
    }

    // optional extension: tombstones ("xt", v1)
    // Encoded FIRST among the extension blocks: blocks have no length prefix, so a
    // forward-compat version bump or a corrupt byte in a later block (ac/sp/dv)
    // stops the parse where it is. Putting tombstones first means that truncation
    // can't drop them — and a dropped tombstone resurrects a deleted event, the
    // worst failure mode of the lot.
    if (tombstones.length) {
      out.push(120, 116); // "xt"
      writeVarUint(1, out);
      writeVarUint(tombstones.length, out);
      for (const t of tombstones) {
        writeString(t.id, out);
        writeString(t.ref, out);
        writeVarUint(t.tsMs, out);
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
        console.warn("db-wallet: encode-v2 normalizeActionCodes failed", e);
      }

      out.push(97, 99); // "ac"
      writeVarUint(2, out);
      writeVarUint(actionCodes.length, out);
      for (const c of actionCodes) {
        writeActionCodeEntry(c, out);
      }
    }

    // optional extension: sync peer device id ("sp", v1)
    const deviceId = typeof getDeviceKey === "function" ? getDeviceKey() : "";
    if (deviceId) {
      out.push(115, 112); // "sp"
      writeVarUint(1, out);
      writeString(deviceId, out);
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
          writeString(deviceKey, out);

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
      console.warn("db-wallet: encode-v2 device list extension failed", e);
    }

    // optional extension: supersedes links ("se", v1) — maps an edit-replacement
    // id to its chain root. Written LAST among the extension blocks: blocks have
    // no length prefix, so an OLD decoder that doesn't know "se" breaks here,
    // AFTER it has already parsed xt/ac/sp/dv. Losing supersedes only reverts
    // that old client to the pre-merge-safe edit behavior (it can't converge
    // concurrent edits, but it already couldn't); a new decoder reads the links
    // and collapses concurrent edits deterministically.
    const superseded = events.filter((e) => e.supersedes);
    if (superseded.length) {
      out.push(115, 101); // "se"
      writeVarUint(1, out);
      writeVarUint(superseded.length, out);
      for (const e of superseded) {
        writeString(e.id, out);
        writeString(e.supersedes, out);
      }
    }

    // optional extension: global action codes ("gc", v1) — the wallet-level 🌍
    // codes (wallet.globalActionCodes), same record layout as "ac" v2 (via
    // writeActionCodeEntry). Global codes have no key: the key field is written
    // as an empty string (same byte layout, so older decoders still parse it),
    // which also keeps the export deterministic.
    // Written AFTER "se" and BEFORE "ck" so the integrity checksum still covers
    // it. An OLD decoder that doesn't know "gc" stops here (blocks have no length
    // prefix) — it simply skips the global codes, like any later unknown block.
    const rawGlobalCodes =
      wallet && Array.isArray(wallet.globalActionCodes)
        ? wallet.globalActionCodes
        : [];
    let globalCodes = rawGlobalCodes;
    try {
      const api = window.dbWalletActionCodes || null;
      if (api && typeof api.normalizeGlobalActionCodes === "function") {
        globalCodes = api.normalizeGlobalActionCodes(rawGlobalCodes);
      }
    } catch (e) {
      console.warn(
        "db-wallet: encode-v2 normalizeGlobalActionCodes failed",
        e,
      );
    }
    if (globalCodes.length) {
      out.push(103, 99); // "gc"
      writeVarUint(1, out);
      writeVarUint(globalCodes.length, out);
      for (const c of globalCodes) {
        writeActionCodeEntry(c, out);
      }
    }

    // optional extension: integrity checksum ("ck", v1) — fnv1a64 truncated to
    // 32 bits over every preceding byte. Written ABSOLUTELY LAST so it covers all
    // other blocks. Hardens the uncompressed i2u: and legacy import: paths that
    // gzip's CRC doesn't cover: a corrupt byte flips the checksum and the decoder
    // rejects instead of silently importing wrong data. Old decoders stop at this
    // unknown block without verifying (graceful).
    if (helpers && typeof helpers.fnv1a64 === "function") {
      const sum = Number(helpers.fnv1a64(out) & 0xffffffffn);
      out.push(99, 107); // "ck"
      writeVarUint(1, out);
      out.push((sum >>> 24) & 0xff);
      out.push((sum >>> 16) & 0xff);
      out.push((sum >>> 8) & 0xff);
      out.push(sum & 0xff);
    }

    return new Uint8Array(out);
  }

  // Delegate the sanitization chain (lowercase, whitespace -> '-', strip to
  // [a-z0-9_-], length-cap 64) to the shared helper so an imported userId can't
  // carry arbitrary characters into a localStorage key / URL fragment. Keep this
  // module's "user-" + randomId() fallback for the empty result.
  function sanitizeImportedUserId(input) {
    return normalizeUserId(input) || "user-" + randomId();
  }

  // A walletId is base64url of the 12 random bytes randomWalletId() produces, so
  // the binary codec can round-trip it through base64UrlDecodeBytes. Reject
  // anything that isn't base64url-shaped or decodes to an implausible byte length
  // (which would throw inside encodeImportV2Bytes and brick export).
  function isValidWalletId(id) {
    if (typeof id !== "string" || !id) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
    try {
      const bytes = base64UrlDecodeBytes(id);
      return bytes.length >= 4 && bytes.length <= 64;
    } catch (e) {
      return false;
    }
  }

  function resolveUserIdForImport(remote) {
    const remoteWalletId =
      typeof remote.walletId === "string" ? remote.walletId : "";
    const remoteUserId =
      typeof remote.userId === "string" && remote.userId
        ? sanitizeImportedUserId(remote.userId)
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

  // The only event fields an import may carry into the stored log. Anything
  // else in a crafted JSON/link payload is dropped instead of being persisted
  // (and re-exported) verbatim.
  const IMPORT_EVENT_FIELDS = ["id", "t", "n", "ts", "ref", "supersedes", "oid"];

  // Whitelist + canonicalize remote events through the storage normalizer, so
  // the merged wallet is already in the shape loadWallet would produce (a raw
  // shape would read as a two-tab collision on the next save and re-mint).
  function sanitizeImportedEvents(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== "object") {
        if (raw) out.push(raw); // let mergeEvents count it as dropped
        continue;
      }
      const picked = {};
      for (const k of IMPORT_EVENT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) picked[k] = raw[k];
      }
      for (const k of ["ref", "supersedes", "oid"]) {
        if (k in picked && typeof picked[k] !== "string") delete picked[k];
      }
      const norm =
        typeof storage.normalizeEvent === "function"
          ? storage.normalizeEvent(picked)
          : picked;
      // Keep id-less/typeless entries for mergeEvents' dropped-count warning.
      out.push(norm || picked);
    }
    return out;
  }

  function buildImportedWallet(remote) {
    const userId = resolveUserIdForImport(remote);
    const local = loadWallet(userId);
    const mergedEvents = mergeEvents(
      local.events,
      sanitizeImportedEvents(remote && remote.events),
    );
    try {
      const api = window.dbWalletActionCodes || null;
      if (api && typeof api.mergeActionCodes === "function") {
        local.actionCodes = api.mergeActionCodes(
          local.actionCodes,
          remote && remote.actionCodes,
          local.deletedActionCodes,
        );
      } else if (remote && Array.isArray(remote.actionCodes)) {
        local.actionCodes = remote.actionCodes;
      }
    } catch (e) {
      console.warn("db-wallet: import action codes merge failed", e);
    }

    // Global action codes: same key-rotation invariant as mergeActionCodes (an
    // imported code updates label/amount/type but never rotates an existing
    // local key). Only touch the field when either side actually has codes, so
    // wallets that never used global codes don't grow an empty array.
    try {
      const remoteGlobal =
        remote && Array.isArray(remote.globalActionCodes)
          ? remote.globalActionCodes
          : [];
      const localGlobal = Array.isArray(local.globalActionCodes)
        ? local.globalActionCodes
        : [];
      if (remoteGlobal.length || localGlobal.length) {
        const api = window.dbWalletActionCodes || null;
        if (api && typeof api.mergeGlobalActionCodes === "function") {
          local.globalActionCodes = api.mergeGlobalActionCodes(
            localGlobal,
            remoteGlobal,
            local.deletedActionCodes,
          );
        } else if (remoteGlobal.length) {
          local.globalActionCodes = remoteGlobal;
        }
      }
    } catch (e) {
      console.warn("db-wallet: import global action codes merge failed", e);
    }

    // Validate the remote walletId before persisting it: encodeImportV2Bytes
    // feeds walletId to base64UrlDecodeBytes, which throws on non-base64url
    // input — a crafted '#import:' JSON would then permanently brick binary
    // QR/link export for this wallet. On an invalid value, fall through to the
    // fresh valid walletId loadWallet already generated (import still succeeds).
    const validRemoteWalletId =
      isValidWalletId(remote.walletId) ? remote.walletId : null;
    local.walletId =
      validRemoteWalletId || local.walletId || randomWalletId();
    local.v =
      typeof remote.v === "number" && Number.isFinite(remote.v) && remote.v > 0
        ? remote.v
        : local.v || 1;
    local.events = mergedEvents;

    // Surface a partial import (id-less remote events skipped during merge) so
    // importRemoteWallet warns instead of reporting a clean success.
    if (mergedEvents && mergedEvents._droppedEventCount > 0 && remote) {
      remote._extWarning = true;
    }

    // If the merge pulled in non-compact (v1) ids, migrate the COMBINED wallet
    // instead of silently downgrading to v=1 and re-prompting migration on every
    // load. migrateV1toV2 is idempotent for already-compact ids and re-points the
    // tombstone refs of the events it migrates.
    const allCompactBefore = local.events.every((e) => {
      const id = e && typeof e.id === "string" ? e.id : "";
      return !!parseCompactEventId(id);
    });
    if (!allCompactBefore && typeof window.dbWalletMigrateV1toV2 === "function") {
      try {
        window.dbWalletMigrateV1toV2(local);
      } catch (e) {
        console.warn("db-wallet: import v1->v2 migration failed", e);
      }
    }

    // Belt-and-suspenders: re-point any remaining legacy-form tombstone ref or
    // edit `supersedes` link to its v2 id. Migration only remaps links whose
    // target it migrated in the same pass; a link to an already-compact target
    // (e.g. migrated earlier on this device) would otherwise stay legacy-form —
    // the deleted event resurfaces, or the edited entry counts twice. Resolve
    // via the target's recorded `oid` first, then the deterministic alias.
    try {
      const v2IdSet = new Set();
      const byOid = new Map();
      for (const e of local.events) {
        if (e && typeof e.id === "string" && e.id) {
          v2IdSet.add(e.id);
          if (typeof e.oid === "string" && e.oid && !byOid.has(e.oid)) {
            byOid.set(e.oid, e.id);
          }
        }
      }
      const resolve = (legacy) => {
        if (typeof legacy !== "string" || !legacy.includes("-")) return null;
        if (byOid.has(legacy)) return byOid.get(legacy);
        const v2 = legacyIdToV2Id(legacy);
        return v2 && v2IdSet.has(v2) ? v2 : null;
      };
      for (const e of local.events) {
        if (!e) continue;
        if (e.t === "x") {
          const v2Ref = resolve(e.ref);
          if (v2Ref) e.ref = v2Ref;
        }
        const v2Sup = resolve(e.supersedes);
        if (v2Sup) e.supersedes = v2Sup;
      }
    } catch (e) {
      console.warn("db-wallet: import legacy-ref remap failed", e);
    }

    const allCompact = local.events.every((e) => {
      const id = e && typeof e.id === "string" ? e.id : "";
      return !!parseCompactEventId(id);
    });
    local.v = allCompact ? (local.v < 2 ? 2 : local.v) : 1;

    // sync status tracking (local-only)
    try {
      // null-prototype map without prototype-chain keys: peerKey is derived
      // from the imported deviceId/walletId (see storage.normalizeSyncPeers).
      local.syncPeers = storage.normalizeSyncPeers(local.syncPeers);

      const peerKeyRaw =
        remote && typeof remote.deviceId === "string" && !("seq" in remote) // only V2 "sp" extension, not JSON export field
          ? remote.deviceId.trim()
          : "";
      // A "__proto__"/"constructor"/"prototype" deviceId is never a peer key;
      // fall back to the walletId-derived key like a missing deviceId.
      let peerKey = storage.isForbiddenMapKey(peerKeyRaw) ? "" : peerKeyRaw;
      if (!peerKey) {
        const wid =
          remote && typeof remote.walletId === "string" ? remote.walletId : "";
        peerKey = wid ? "remote-" + wid.slice(0, 8) : "remote-unknown";
      }

      const existing = Object.prototype.hasOwnProperty.call(
        local.syncPeers,
        peerKey,
      )
        ? local.syncPeers[peerKey]
        : null;
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
      // One-way import: common = remote events (all now in local), not merged length — otherwise local-only events never show as sync-delta.
      peer.commonEventCount = Math.min(peerEventCount, local.events.length);
      local.syncPeers[peerKey] = peer;
    } catch (e) {
      console.warn("db-wallet: import sync-peer tracking failed", e);
    }

    // device list (synced): merge + normalize + max 6
    try {
      if (typeof mergeWalletDevices === "function") {
        mergeWalletDevices(local, remote && remote.devices);
      }
    } catch (e) {
      console.warn("db-wallet: import device list merge failed", e);
    }

    return { userId, wallet: local };
  }

  const IMPORT_SAVE_FAILED_MESSAGE =
    "Import fehlgeschlagen: Die Daten konnten nicht gespeichert werden (Speicher voll oder blockiert). Nichts wurde importiert.";

  function importRemoteWallet(remote, options) {
    const { userId, wallet } = buildImportedWallet(remote);
    ensureDeviceSeq(wallet);
    // A failed save (storage full/blocked) must not end in "importiert ✅" and a
    // redirect to a wallet that holds none of the imported data: report it once.
    // The import link is dropped from the address bar (back to the wallet that
    // was open, if any) — a reload must not replay the failing import.
    if (!saveWallet(wallet, { quiet: true })) {
      alert(IMPORT_SAVE_FAILED_MESSAGE);
      replaceHash(returnUserIdOf(options));
      return null;
    }
    applyImportedTheme(remote, options);
    replaceHash(userId);
    alert(
      remote && remote._extWarning
        ? "Getränkedaten importiert ✅\nHinweis: Ein Teil der Daten (Zusatzdaten oder Einträge ohne gültige ID) konnte nicht vollständig importiert und wurde übersprungen."
        : "Getränkedaten importiert ✅",
    );
    return userId;
  }

  // Decodes a wallet import hash into a typed payload object, or null if
  // the hash is not a recognized import format. Async because "i2:" requires
  // gzip decompression.
  function decodeTokenBytes(token) {
    try {
      return base64UrlDecodeBytes(token);
    } catch (e) {
      throw asImportError(e, "corrupt");
    }
  }

  function decodePayloadBytes(raw) {
    try {
      return decodeImportV2Bytes(raw);
    } catch (e) {
      throw asImportError(e, "corrupt");
    }
  }

  async function parseImportHashPayload(hash) {
    if (hash.startsWith("i2u:")) {
      const raw = decodeTokenBytes(hash.slice(4));
      // i2u carries the payload uncompressed, so guard on the raw byte length.
      // Use the same ceiling as i2:'s post-decompress bound (2 MB) — i2: and
      // import: both already cap; this closes the last unguarded path.
      if (raw.length > 2 * 1024 * 1024) {
        throw importError("too-large", "Import payload too large");
      }
      const remote = decodePayloadBytes(raw);
      return { kind: "i2u", remote, label: "QR-Import (kurz)" };
    }
    if (hash.startsWith("i2:")) {
      const compressed = decodeTokenBytes(hash.slice(3));
      if (compressed.length > 512 * 1024) {
        throw importError("too-large", "Import payload too large");
      }
      if (typeof DecompressionStream === "undefined") {
        throw importError("unsupported-browser", "DecompressionStream not available");
      }
      let raw;
      try {
        raw = await gzipDecompress(compressed, 2 * 1024 * 1024);
      } catch (e) {
        const tooLarge = String((e && e.message) || "").includes("too large");
        throw asImportError(e, tooLarge ? "too-large" : "corrupt");
      }
      const remote = decodePayloadBytes(raw);
      return { kind: "i2", remote, label: "QR-Import (kurz)" };
    }
    if (hash.startsWith("import:")) {
      const b64 = hash.slice(7);
      // The legacy JSON path had no size guard (unlike i2:), so a multi-MB link
      // could freeze the tab in base64-decode + JSON.parse + merge. Cap it.
      if (b64.length > 3 * 1024 * 1024) {
        throw importError("too-large", "Import payload too large");
      }
      let payload;
      try {
        payload = base64UrlDecode(b64);
      } catch (e) {
        throw asImportError(e, "corrupt");
      }
      const remote = safeParse(payload);
      if (!remote || typeof remote !== "object") {
        throw importError("corrupt", "Invalid import payload");
      }
      return { kind: "import", remote, label: "Import-Link erkannt" };
    }
    if (hash.startsWith("ac:")) {
      return { kind: "ac" };
    }
    return null;
  }

  function getImportPreviewHooks() {
    const importPreview = window.dbWalletImportPreview || null;
    return {
      chooseMode:
        importPreview && typeof importPreview.chooseImportMode === "function"
          ? importPreview.chooseImportMode
          : null,
      openPreview:
        importPreview && typeof importPreview.openPreview === "function"
          ? importPreview.openPreview
          : null,
    };
  }

  // A cancelled import goes back to the wallet that was open (the import link
  // is replaced by its hash, the wallet stays loaded); without one, to the
  // start page as before.
  function leaveCancelledImport(options) {
    const back = returnUserIdOf(options);
    if (back) {
      replaceHash(back);
      return { userId: null, redirectedToPreview: false };
    }
    window.location.href = "index.html";
    return { userId: null, redirectedToPreview: true };
  }

  // Dispatches a parsed import payload between the preview overlay and the
  // persist-and-route path. Returns the standard tryImportFromHash shape.
  async function handleImportChoice(remote, label, options, hooks) {
    const { chooseMode, openPreview } = hooks || getImportPreviewHooks();

    let mode = "persist";
    if (chooseMode) {
      mode = await chooseMode({ header: label || "Import erkannt" });
      if (!mode) return leaveCancelledImport(options);
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
      if (ok) return { userId: null, redirectedToPreview: true };
      return leaveCancelledImport(options);
    }

    return {
      userId: importRemoteWallet(remote, options),
      redirectedToPreview: false,
    };
  }

  // Decodes an "ac:" action-code hash and validates the walletId/codeId/key
  // triple. Returns { payload, activeUserId } on success or a terminal
  // tryImportFromHash result (via the `done` field) for short-circuit cases.
  function parseActionCodeHash(hash, options) {
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
      throw importError("corrupt", "Invalid action payload");
    }

    const payloadWalletId =
      typeof payload.walletId === "string" ? payload.walletId : "";
    const codeId = typeof payload.codeId === "string" ? payload.codeId : "";
    const key = typeof payload.key === "string" ? payload.key : "";

    if (!payloadWalletId) {
      alert("Action Code ungültig: Ziel-Wallet fehlt.\nBuchung verweigert.");
      return { done: redirectAfterActionError(activeUserId) };
    }
    if (!codeId || !key) {
      alert("Action Code ungültig (Daten fehlen).\nBuchung verweigert.");
      return { done: redirectAfterActionError(activeUserId) };
    }

    return { api, payload, payloadWalletId, codeId, key, activeUserId };
  }

  function redirectAfterActionError(activeUserId) {
    if (activeUserId) {
      replaceHash(activeUserId);
      return { userId: activeUserId, redirectedToPreview: false };
    }
    window.location.href = "index.html";
    return { userId: null, redirectedToPreview: true };
  }

  // Given a parsed action payload, locate the target userId, prompt the user
  // when the wallet is missing or belongs to a different profile, and return
  // either a resolved targetUserId or a terminal tryImportFromHash result.
  function resolveActionCodeTarget(parsed) {
    const { payloadWalletId, activeUserId } = parsed;
    const targetUserId = findUserIdByWalletId(payloadWalletId);
    if (!targetUserId) {
      const shouldGoHome = window.confirm(
        "Dieses Wallet ist auf diesem Gerät noch nicht vorhanden.\nVor dem Buchen muss es importiert werden.\nJetzt zur Startseite wechseln?",
      );
      if (!shouldGoHome) {
        if (activeUserId) {
          replaceHash(activeUserId);
          return {
            done: { userId: activeUserId, redirectedToPreview: false },
          };
        }
        return { done: { userId: null, redirectedToPreview: false } };
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
      return { done: { userId: null, redirectedToPreview: true } };
    }

    if (activeUserId && targetUserId !== activeUserId) {
      const shouldSwitch = window.confirm(
        `Action Code gehört zu einem anderen Profil.\nZiel: ${targetUserId}\nAktuell: ${activeUserId}\nZu diesem Profil wechseln und buchen?`,
      );
      if (!shouldSwitch) {
        replaceHash(activeUserId);
        return { done: { userId: activeUserId, redirectedToPreview: false } };
      }
    }
    return { targetUserId };
  }

  // Applies a validated action payload to the target wallet: matches the code,
  // books the event, persists, and updates the hash. Returns the standard
  // tryImportFromHash result.
  function bookActionCode(targetUserId, parsed) {
    const { api, payload, codeId, key } = parsed;
    const wallet = loadWallet(targetUserId);
    ensureDeviceSeq(wallet);

    try {
      if (api && typeof api.ensureWalletActionCodes === "function") {
        const res = api.ensureWalletActionCodes(wallet);
        if (res && res.changed) saveWallet(wallet);
      }
    } catch (e) {
      console.warn("db-wallet: ensureWalletActionCodes failed", e);
    }

    const codes = Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];
    const match = codeId && codes.find((c) => c && c.id === codeId);
    if (!match) {
      alert(
        "Action Code ist unbekannt oder nicht mehr vorhanden.\nBuchung verweigert.",
      );
      replaceHash(targetUserId);
      return { userId: targetUserId, redirectedToPreview: false };
    }

    const matchKey = match && typeof match.key === "string" ? match.key : "";
    if (!matchKey || matchKey !== key) {
      alert(
        "Action Code wurde erneuert.\nBitte den neuen QR-Code nutzen.\nBuchung verweigert.",
      );
      replaceHash(targetUserId);
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
    // Always book the STORED code's type — never let the scanned payload override
    // it. A crafted local 'ac:' QR could otherwise flip a credit ('g') code into
    // a drink (debit) via payload.type. The legitimate generator never emits a
    // type for local codes; the global 'acg:' path is self-describing and handled
    // separately.
    const type = normalizeType(match.type) || "g";

    const event = newEvent(wallet, type === "d" ? "d" : "g", amount);
    if (!appendEvents(wallet, [event])) {
      alert(
        "Speichern fehlgeschlagen — Buchung verworfen (Speicher voll oder blockiert).",
      );
      replaceHash(targetUserId);
      return { userId: targetUserId, redirectedToPreview: false };
    }
    replaceHash(targetUserId);
    alert(
      type === "d"
        ? `${amount} Getränk(e) getrunken gebucht ✅`
        : `Guthaben +${amount} Getränke gebucht ✅`,
    );
    return { userId: targetUserId, redirectedToPreview: false };
  }

  function handleActionCodeHash(hash, options) {
    const parsed = parseActionCodeHash(hash, options);
    if (parsed.done) return parsed.done;
    const resolved = resolveActionCodeTarget(parsed);
    if (resolved.done) return resolved.done;
    return bookActionCode(resolved.targetUserId, parsed);
  }

  async function tryImportFromHash(options) {
    const hash = window.location.hash.slice(1);
    if (!hash) return { userId: null, redirectedToPreview: false };

    try {
      if (hash.startsWith("ac:")) {
        return handleActionCodeHash(hash, options);
      }
      const parsed = await parseImportHashPayload(hash);
      if (parsed && parsed.kind !== "ac") {
        return await handleImportChoice(
          parsed.remote,
          parsed.label,
          options,
          getImportPreviewHooks(),
        );
      }
      return { userId: null, redirectedToPreview: false };
    } catch (e) {
      alert(IMPORT_ERROR_MESSAGES[importErrorCode(e)]);
      // Drop the failed link from the address bar without a history entry:
      // back to the open wallet's hash, or no hash on a cold start (wallet-ui
      // then shows the no-wallet state).
      replaceHash(returnUserIdOf(options));
      return { userId: null, redirectedToPreview: false };
    }
  }

  window.dbWalletImportV2 = {
    writeVarUint,
    readVarUint,
    fnv1a64: helpers.fnv1a64,
    hash53,
    legacyIdToV2Id,
    mergeEvents,
    themeIndexFromName,
    themeNameFromIndex,
    encodeImportV2Bytes,
    decodeImportV2Bytes,
    decodeV2Header,
    decodeV2Events,
    decodeV2Extensions,
    resolveUserIdForImport,
    applyImportedTheme,
    buildImportedWallet,
    importRemoteWallet,
    IMPORT_SAVE_FAILED_MESSAGE,
    IMPORT_ERROR_MESSAGES,
    importErrorCode,
    parseImportHashPayload,
    handleImportChoice,
    parseActionCodeHash,
    resolveActionCodeTarget,
    bookActionCode,
    handleActionCodeHash,
    tryImportFromHash,
  };
})();
