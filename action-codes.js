(function () {
  const helpers = window.dbWalletHelpers || null;
  if (
    !helpers ||
    typeof helpers.base64UrlEncode !== "function" ||
    typeof helpers.base64UrlDecode !== "function" ||
    typeof helpers.safeParse !== "function" ||
    typeof helpers.randomToken !== "function"
  ) {
    return;
  }
  const SOFT_LIMIT = 6;
  const HARD_LIMIT = 10;

  const { base64UrlEncode, base64UrlDecode, safeParse, randomToken } = helpers;

  const MAX_AMOUNT =
    typeof helpers.MAX_EVENT_AMOUNT === "number" ? helpers.MAX_EVENT_AMOUNT : 1e9;

  // 1..MAX_EVENT_AMOUNT. Without the upper bound the form stored 1e20 and every
  // later QR export threw in the codec's varint writer.
  function normalizeAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.min(MAX_AMOUNT, Math.max(1, Math.round(n)));
  }

  function normalizeType(value) {
    const t = typeof value === "string" ? value.trim() : "";
    return t === "d" ? "d" : "g";
  }

  function normalizeScope(value) {
    return value === "global" ? "global" : "local";
  }

  const GLOBAL_ACTION_VERSION = 1;
  const GLOBAL_ACTION_MAX_AMOUNT = 100;

  function clampGlobalAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    const clamped = Math.min(GLOBAL_ACTION_MAX_AMOUNT, Math.max(1, rounded));
    return clamped;
  }

  function normalizeGlobalAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (typeof value === "number" && rounded !== n) return null;
    if (rounded < 1 || rounded > GLOBAL_ACTION_MAX_AMOUNT) return null;
    return rounded;
  }

  function normalizeGlobalPayload(input) {
    if (!input || typeof input !== "object") return null;
    const vRaw = typeof input.v === "number" ? Math.floor(input.v) : null;
    const v =
      vRaw === null || !Number.isFinite(vRaw) ? GLOBAL_ACTION_VERSION : vRaw;
    if (v !== GLOBAL_ACTION_VERSION) return null;
    const t = input.t === "d" || input.t === "g" ? input.t : "";
    if (!t) return null;
    const n = normalizeGlobalAmount(input.n);
    if (n === null) return null;
    const label =
      typeof input.l === "string" && input.l.trim() !== ""
        ? input.l.trim().slice(0, 64)
        : "";
    const out = { v, t, n };
    if (label) out.l = label;
    return out;
  }

  // The booking an `acg:` payload asks for: the one reading of it (the confirm
  // in wallet-ui.js, the wallet picker in wallet-hash-actions.js). null for an
  // invalid payload.
  function globalPayloadAction(payload) {
    const p = normalizeGlobalPayload(payload);
    if (!p) return null;
    return { type: p.t, amount: p.n, label: p.l || "" };
  }

  function defaultLabelForType(type, amount) {
    const amountValue = normalizeAmount(amount);
    const normalizedType = normalizeType(type);
    return normalizedType === "d"
      ? `Drink +${amountValue}`
      : `Guthaben +${amountValue}`;
  }

  function amountPromptForType(type) {
    return normalizeType(type) === "d"
      ? "Wie viele Getränke soll der neue Code trinken?"
      : "Wie viele Getränke soll der neue Code gutschreiben?";
  }

  function rotateActionCodeKey(code, now = Date.now()) {
    if (!code || typeof code !== "object") return;
    code.key = randomToken(18);
    code.updatedAt = now;
    if (!code.createdAt) code.createdAt = code.updatedAt;
  }

  function buildActionCode(data, now = Date.now()) {
    const type = normalizeType(data && data.type);
    const amount = normalizeAmount(data && data.amount);
    const labelRaw = data && typeof data.label === "string" ? data.label : "";
    const label =
      String(labelRaw || "").trim() || defaultLabelForType(type, amount);
    return {
      id: randomToken(10),
      label,
      amount,
      type,
      key: randomToken(18),
      createdAt: now,
      updatedAt: now,
    };
  }

  function buildGlobalCode(data, now = Date.now()) {
    const type = normalizeType(data && data.type);
    const amountRaw = clampGlobalAmount(data && data.amount);
    const amount = amountRaw === null ? 1 : amountRaw;
    const labelRaw = data && typeof data.label === "string" ? data.label : "";
    const label =
      String(labelRaw || "").trim() || defaultLabelForType(type, amount);
    return {
      id: `global:${randomToken(10)}`,
      label,
      amount,
      type,
      scope: "global",
      createdAt: now,
      updatedAt: now,
    };
  }

  function applyActionCodeEdits(code, updates, now = Date.now()) {
    if (!code || typeof code !== "object") return false;
    const nextAmount = normalizeAmount(updates && updates.amount);
    const nextType = normalizeType(updates && updates.type);
    const nextLabelRaw =
      updates && typeof updates.label === "string" ? updates.label : "";
    const nextLabel =
      String(nextLabelRaw || "").trim() || defaultLabelForType(nextType, nextAmount);
    const prevLabel = code.label || "";
    const changed =
      nextAmount !== code.amount ||
      nextType !== code.type ||
      nextLabel !== prevLabel;
    code.amount = nextAmount;
    code.type = nextType;
    code.label = nextLabel;
    if (changed) {
      rotateActionCodeKey(code, now);
    } else {
      code.updatedAt = now;
      if (!code.createdAt) code.createdAt = code.updatedAt;
    }
    return true;
  }

  // Cap a timestamp at `now`: a crafted far-future createdAt/updatedAt must not
  // win the strict-> recency check in mergeActionCodes and silently overwrite a
  // stored code.
  function clampTimestamp(value, now) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.min(Math.floor(value), now);
  }

  function normalizeActionCode(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    // Length-cap the label: an imported code label is otherwise unbounded and
    // bloats the DOM + storage.
    const label =
      typeof raw.label === "string" ? raw.label.trim().slice(0, 64) : "";
    const amount = normalizeAmount(raw.amount);
    const type = normalizeType(raw.type);
    const key =
      typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : "";
    const createdAt = clampTimestamp(raw.createdAt, now);
    const updatedAt = clampTimestamp(raw.updatedAt, now);
    return {
      id,
      label,
      amount,
      type,
      key,
      createdAt,
      updatedAt,
    };
  }

  function compareActionCodes(a, b) {
    const au = a && typeof a.updatedAt === "number" ? a.updatedAt : 0;
    const bu = b && typeof b.updatedAt === "number" ? b.updatedAt : 0;
    if (au !== bu) return bu - au;
    const ac = a && typeof a.createdAt === "number" ? a.createdAt : 0;
    const bc = b && typeof b.createdAt === "number" ? b.createdAt : 0;
    if (ac !== bc) return bc - ac;
    const aid = a && typeof a.id === "string" ? a.id : "";
    const bid = b && typeof b.id === "string" ? b.id : "";
    return aid.localeCompare(bid);
  }

  // `idPrefix` is for the global wrapper: an id minted here (missing or
  // duplicate) gets the same "global:" prefix as buildGlobalCode.
  function normalizeActionCodes(list, now = Date.now(), idPrefix = "") {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    const seen = new Set();

    for (const raw of arr) {
      const code = normalizeActionCode(raw, now);
      if (!code) continue;

      if (!code.id) code.id = idPrefix + randomToken(10);
      if (!code.key) code.key = randomToken(18);
      if (!code.updatedAt && !code.createdAt) {
        code.updatedAt = now;
        code.createdAt = now;
      } else if (!code.updatedAt) {
        code.updatedAt = code.createdAt;
      } else if (!code.createdAt) {
        code.createdAt = code.updatedAt;
      }
      if (!code.label) {
        const typeLabel = code.type === "d" ? "Drink" : "Guthaben";
        code.label = `${typeLabel} +${code.amount}`;
      }

      let id = code.id;
      while (seen.has(id)) {
        id = idPrefix + randomToken(10);
      }
      code.id = id;
      seen.add(id);
      out.push(code);
    }

    out.sort(compareActionCodes);
    const trimmedCount = Math.max(0, out.length - HARD_LIMIT);
    const trimmed = out.slice(0, HARD_LIMIT);
    if (trimmedCount > 0) {
      trimmed._dbwTrimmed = trimmedCount;
    }
    return trimmed;
  }

  // Global ('🌍') codes have no key — they are applied by id via `#acg:` with a
  // confirm, not booked against a device secret. normalizeActionCodes is the
  // local-code normalizer (invents a key, drops scope); this wrapper restores
  // the global shape: scope "global", no key, amount 1..100. Used by the codec
  // (encode and decode), the import merge and the save reconcile, so a global
  // code keeps its scope across export -> import and two exports are identical.
  function normalizeGlobalActionCodes(list, now = Date.now()) {
    const normalized = normalizeActionCodes(list, now, "global:");
    const out = normalized.map((c) => {
      delete c.key;
      c.scope = "global";
      const amount = clampGlobalAmount(c.amount);
      c.amount = amount === null ? 1 : amount;
      return c;
    });
    if (typeof normalized._dbwTrimmed === "number") {
      out._dbwTrimmed = normalized._dbwTrimmed;
    }
    return out;
  }

  function mergeGlobalActionCodes(localList, remoteList, deleted) {
    const merged = mergeActionCodes(localList, remoteList, deleted);
    return normalizeGlobalActionCodes(merged);
  }

  // --- Deletion model ---------------------------------------------------
  // wallet.deletedActionCodes = { [codeId]: deletedAtMs }, the newest
  // DELETED_LIMIT entries. Every save reconciles with the persisted copy and
  // every import merges remote codes; both would otherwise resurrect a deleted
  // code (and its still-printed QR keeps booking). Deleting, converting
  // local <-> global, all record the old id here; reconcile and import skip
  // listed ids. The list travels in exports (codec block "dc", JSON field) and
  // an import unions it with the local one (E4), so a code deleted on one
  // device is removed on the others too.
  const DELETED_LIMIT = 50;

  // Times are capped at `now`: a crafted far-future entry would otherwise
  // stay in the newest-50 window forever.
  function normalizeDeletedActionCodes(input, now = Date.now()) {
    const entries = [];
    if (input && typeof input === "object" && !Array.isArray(input)) {
      for (const id of Object.keys(input)) {
        if (!id) continue;
        const ts = input[id];
        const at =
          typeof ts === "number" && Number.isFinite(ts) && ts > 0
            ? Math.min(Math.floor(ts), now)
            : 0;
        entries.push([id, at]);
      }
    }
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    // null-prototype: ids are bracket-assigned keys and may come from storage.
    const out = Object.create(null);
    for (const [id, at] of entries.slice(0, DELETED_LIMIT)) out[id] = at;
    return out;
  }

  function mergeDeletedActionCodes(a, b) {
    const merged = Object.create(null);
    for (const src of [normalizeDeletedActionCodes(a), normalizeDeletedActionCodes(b)]) {
      for (const id of Object.keys(src)) {
        if (!(id in merged) || src[id] > merged[id]) merged[id] = src[id];
      }
    }
    return normalizeDeletedActionCodes(merged);
  }

  function isDeletedActionCode(deleted, id) {
    return (
      !!deleted &&
      typeof deleted === "object" &&
      typeof id === "string" &&
      Object.prototype.hasOwnProperty.call(deleted, id)
    );
  }

  function recordDeletedActionCode(wallet, codeId, now = Date.now()) {
    if (!wallet || typeof wallet !== "object") return;
    const id = typeof codeId === "string" ? codeId.trim() : "";
    if (!id) return;
    const next = normalizeDeletedActionCodes(wallet.deletedActionCodes);
    next[id] = Math.max(next[id] || 0, Math.floor(now) || 0);
    wallet.deletedActionCodes = normalizeDeletedActionCodes(next);
  }

  // Drop every listed id from both code lists (in place on the wallet).
  function applyDeletedActionCodes(wallet) {
    if (!wallet || typeof wallet !== "object") return;
    const deleted = wallet.deletedActionCodes;
    if (!deleted || typeof deleted !== "object") return;
    const keep = (c) => !(c && isDeletedActionCode(deleted, c.id));
    if (Array.isArray(wallet.actionCodes)) {
      wallet.actionCodes = wallet.actionCodes.filter(keep);
    }
    if (Array.isArray(wallet.globalActionCodes)) {
      wallet.globalActionCodes = wallet.globalActionCodes.filter(keep);
    }
  }

  // Delete a local or global code: remove it from the wallet and record the id
  // so neither a stale save nor an import brings it back. Returns whether a
  // code was actually removed (the id is recorded either way).
  function removeActionCode(wallet, codeId, now = Date.now()) {
    if (!wallet || typeof wallet !== "object") return false;
    const has = (list) =>
      Array.isArray(list) && list.some((c) => c && c.id === codeId);
    const found = has(wallet.actionCodes) || has(wallet.globalActionCodes);
    recordDeletedActionCode(wallet, codeId, now);
    applyDeletedActionCodes(wallet);
    return found;
  }

  // `deleted` (optional): a deletedActionCodes map; listed ids are skipped on
  // both sides, so an import can't resurrect a code deleted here.
  function mergeActionCodes(localList, remoteList, deleted) {
    const now = Date.now();
    const notDeleted = (list) =>
      (Array.isArray(list) ? list : []).filter(
        (c) => !(c && isDeletedActionCode(deleted, c.id)),
      );
    const local = normalizeActionCodes(notDeleted(localList), now);
    const remote = normalizeActionCodes(notDeleted(remoteList), now);

    const byId = new Map();
    for (const c of local) byId.set(c.id, c);

    for (const c of remote) {
      const existing = byId.get(c.id);
      if (!existing) {
        local.push(c);
        byId.set(c.id, c);
        continue;
      }
      const localUpdated = existing.updatedAt || 0;
      const remoteUpdated = c.updatedAt || 0;
      // Strict > so an equal-timestamp remote can't clobber a freshly rotated
      // local code (same updatedAt ms) and invalidate its already-printed QR.
      if (remoteUpdated > localUpdated) {
        existing.label = c.label;
        existing.amount = c.amount;
        existing.type = c.type;
        // Deliberately do NOT copy c.key: the key is a device-local booking
        // secret, and an unauthenticated import must not be able to rotate it
        // (which would hijack the code / invalidate already-printed QRs). Key
        // rotation stays local-only.
        existing.createdAt = c.createdAt;
        existing.updatedAt = c.updatedAt;
      }
    }
    const merged = normalizeActionCodes(local, now);
    const remoteTrimmed =
      remote && typeof remote._dbwTrimmed === "number" ? remote._dbwTrimmed : 0;
    const mergedTrimmed =
      merged && typeof merged._dbwTrimmed === "number" ? merged._dbwTrimmed : 0;
    if (remoteTrimmed > 0 || mergedTrimmed > 0) {
      merged._dbwTrimmed = Math.max(remoteTrimmed, mergedTrimmed);
    }
    return merged;
  }

  function buildActionPayload(wallet, code) {
    const payload = {
      v: 2,
      walletId:
        wallet && typeof wallet.walletId === "string" ? wallet.walletId : "",
      codeId: code.id,
      key: code.key,
    };
    return payload;
  }

  function encodeGlobalActionHash(input) {
    const payload = normalizeGlobalPayload(input);
    if (!payload) return "";
    const json = JSON.stringify(payload);
    return "acg:" + base64UrlEncode(json);
  }

  function decodeGlobalActionHash(hash) {
    const raw = String(hash || "");
    if (!raw.startsWith("acg:")) return null;
    const token = raw.slice(4);
    if (!token) return null;
    try {
      const json = base64UrlDecode(token);
      const payload = safeParse(json);
      return normalizeGlobalPayload(payload);
    } catch (e) {
      return null;
    }
  }

  function encodeActionHash(payload) {
    const json = JSON.stringify(payload || {});
    return "ac:" + base64UrlEncode(json);
  }

  function decodeActionHash(hash) {
    const raw = String(hash || "");
    if (!raw.startsWith("ac:")) return null;
    const token = raw.slice(3);
    if (!token) return null;
    let payload;
    try {
      const json = base64UrlDecode(token);
      payload = safeParse(json);
    } catch (e) {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const walletId =
      typeof payload.walletId === "string" ? payload.walletId : "";
    const codeId = typeof payload.codeId === "string" ? payload.codeId : "";
    const key = typeof payload.key === "string" ? payload.key : "";
    const v =
      typeof payload.v === "number" && Number.isFinite(payload.v)
        ? payload.v
        : 1;
    const out = { v, walletId, codeId, key };
    const type = typeof payload.type === "string" ? payload.type.trim() : "";
    if (type === "d" || type === "g") out.type = type;
    return out;
  }

  function ensureWalletActionCodes(wallet) {
    if (!wallet || typeof wallet !== "object") return false;
    const now = Date.now();
    const current = Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];
    const normalized = normalizeActionCodes(current, now);
    const prevTrimmed =
      typeof current._dbwTrimmed === "number" ? current._dbwTrimmed : 0;
    const nextTrimmed =
      typeof normalized._dbwTrimmed === "number" ? normalized._dbwTrimmed : 0;
    const trimmedCount = Math.max(prevTrimmed, nextTrimmed);
    if (trimmedCount > 0) {
      normalized._dbwTrimmed = trimmedCount;
    }
    const changed = JSON.stringify(current) !== JSON.stringify(normalized);
    wallet.actionCodes = normalized;
    return {
      changed,
      trimmedCount,
    };
  }

  // --- Code changes as pure functions -----------------------------------
  // (wallet, change) -> { wallet: next, code, trimmedCount } (delete:
  // { wallet: next, removed, trimmedCount }), or null when there is nothing to
  // change. `next` is a shallow copy of the wallet with fresh code lists; the
  // input wallet and its codes stay untouched. The panel (action-codes-ui.js)
  // saves `next` once, so a conversion (delete + create) is a single save and
  // a refused save leaves the shown wallet as it was.
  // `change`: { scope: "local" | "global", type: "d" | "g", amount, label }.
  function copyCodeLists(wallet) {
    const next = Object.assign({}, wallet);
    next.actionCodes = (Array.isArray(wallet.actionCodes) ? wallet.actionCodes : []).map(
      (c) => Object.assign({}, c),
    );
    if (Array.isArray(wallet.globalActionCodes)) {
      next.globalActionCodes = wallet.globalActionCodes.map((c) => Object.assign({}, c));
    }
    return next;
  }

  // Re-applies the caps (10 per list) after a change; returns how many codes
  // fell off. Wallets without global codes don't grow the field.
  function settleCodeLists(next) {
    const res = ensureWalletActionCodes(next);
    let trimmed = res && res.trimmedCount > 0 ? res.trimmedCount : 0;
    if (Array.isArray(next.globalActionCodes)) {
      const globals = normalizeGlobalActionCodes(next.globalActionCodes);
      if (typeof globals._dbwTrimmed === "number") trimmed += globals._dbwTrimmed;
      next.globalActionCodes = globals;
    }
    return trimmed;
  }

  function addCodeOfScope(next, scope, change, now) {
    if (normalizeScope(scope) === "global") {
      const code = buildGlobalCode(change, now);
      next.globalActionCodes = (next.globalActionCodes || []).concat([code]);
      return code;
    }
    const code = buildActionCode(change, now);
    next.actionCodes.push(code);
    return code;
  }

  function createActionCode(wallet, change, now = Date.now()) {
    if (!wallet || typeof wallet !== "object") return null;
    const next = copyCodeLists(wallet);
    const code = addCodeOfScope(next, change && change.scope, change, now);
    const trimmedCount = settleCodeLists(next);
    return { wallet: next, code, trimmedCount };
  }

  // Same scope: the code changes in place (a local edit rotates the key when
  // label/amount/type change, see applyActionCodeEdits; a global code keeps
  // amount 1..100). Other scope: conversion = delete the old code (its id is
  // recorded, so a stale copy can't come back) + create one in the new scope.
  function editActionCode(wallet, codeId, change, now = Date.now()) {
    if (!wallet || typeof wallet !== "object" || !codeId) return null;
    const next = copyCodeLists(wallet);
    const local = next.actionCodes.find((c) => c && c.id === codeId) || null;
    const global =
      !local && Array.isArray(next.globalActionCodes)
        ? next.globalActionCodes.find((c) => c && c.id === codeId) || null
        : null;
    const current = local || global;
    if (!current) return null;
    const fromScope = global ? "global" : "local";
    const toScope = change && change.scope ? normalizeScope(change.scope) : fromScope;
    let code = current;
    if (toScope !== fromScope) {
      removeActionCode(next, codeId, now);
      code = addCodeOfScope(next, toScope, change, now);
    } else if (fromScope === "local") {
      applyActionCodeEdits(current, change, now);
    } else {
      current.type = normalizeType(change && change.type);
      const amount = clampGlobalAmount(change && change.amount);
      current.amount = amount === null ? 1 : amount;
      const label = String((change && change.label) || "").trim();
      current.label = label || defaultLabelForType(current.type, current.amount);
      current.updatedAt = now;
    }
    const trimmedCount = settleCodeLists(next);
    return { wallet: next, code, trimmedCount };
  }

  function deleteActionCode(wallet, codeId, now = Date.now()) {
    if (!wallet || typeof wallet !== "object" || !codeId) return null;
    const next = copyCodeLists(wallet);
    const removed = removeActionCode(next, codeId, now);
    const trimmedCount = settleCodeLists(next);
    return { wallet: next, removed, trimmedCount };
  }

  // The link a code's QR carries: `#acg:` (self-describing, no key) for a
  // global code, `#ac:` (walletId + codeId + key) for a local one.
  function buildActionUrl(wallet, code, baseUrl) {
    const base = String(baseUrl || "");
    if (normalizeScope(code && code.scope) === "global") {
      const label = code && typeof code.label === "string" ? code.label.trim() : "";
      const amount = clampGlobalAmount(code && code.amount);
      const payload = {
        v: GLOBAL_ACTION_VERSION,
        t: normalizeType(code && code.type),
        n: amount === null ? 1 : amount,
      };
      if (label) payload.l = label;
      const hash = encodeGlobalActionHash(payload);
      return hash ? base + "#" + hash : "";
    }
    return base + "#" + encodeActionHash(buildActionPayload(wallet, code));
  }

  window.dbWalletActionCodes = {
    mergeActionCodes,
    mergeGlobalActionCodes,
    normalizeGlobalActionCodes,
    globalPayloadAction,
    removeActionCode,
    applyDeletedActionCodes,
    mergeDeletedActionCodes,
    normalizeDeletedActionCodes,
    normalizeActionCodes,
    buildActionCode,
    buildGlobalCode,
    applyActionCodeEdits,
    createActionCode,
    editActionCode,
    deleteActionCode,
    buildActionUrl,
    buildActionPayload,
    encodeGlobalActionHash,
    decodeGlobalActionHash,
    decodeActionHash,
    encodeActionHash,
    ensureWalletActionCodes,
    normalizeAmount,
    normalizeType,
    normalizeScope,
    clampGlobalAmount,
    defaultLabelForType,
    amountPromptForType,
    HARD_LIMIT,
    SOFT_LIMIT,
    GLOBAL_ACTION_MAX_AMOUNT,
  };
})();
