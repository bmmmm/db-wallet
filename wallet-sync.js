(function () {
  function ensureSyncPeers(wallet) {
    if (!wallet || typeof wallet !== "object") return {};
    const raw = wallet.syncPeers;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      wallet.syncPeers = {};
    }
    return wallet.syncPeers;
  }

  function pickActivePeer(wallet) {
    const peers = wallet && wallet.syncPeers ? wallet.syncPeers : null;
    if (!peers || typeof peers !== "object") return null;

    let bestKey = null;
    let bestPeer = null;
    let bestUpdatedAt = -1;

    for (const [key, peer] of Object.entries(peers)) {
      if (!peer || typeof peer !== "object") continue;
      const updatedAt =
        typeof peer.updatedAt === "number" && Number.isFinite(peer.updatedAt)
          ? Math.floor(peer.updatedAt)
          : -1;
      if (updatedAt > bestUpdatedAt) {
        bestUpdatedAt = updatedAt;
        bestKey = key;
        bestPeer = peer;
      }
    }

    if (!bestPeer || !bestKey || bestUpdatedAt <= 0) return null;
    return { peerKey: bestKey, peer: bestPeer };
  }

  function computeAgeDays(peer) {
    const updatedAt =
      peer &&
      typeof peer.updatedAt === "number" &&
      Number.isFinite(peer.updatedAt)
        ? Math.floor(peer.updatedAt)
        : 0;
    if (updatedAt <= 0) return null;
    const ageMs = Date.now() - updatedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
    return Math.floor(ageMs / 86400000);
  }

  function computeTrafficLight(ageDays) {
    if (typeof ageDays !== "number" || !Number.isFinite(ageDays)) {
      return { level: "unknown", icon: "❔" };
    }
    if (ageDays <= 5) return { level: "green", icon: "✅" };
    if (ageDays <= 10) return { level: "yellow", icon: "⚠️" };
    return { level: "red", icon: "🛑" };
  }

  function clampInt(n) {
    const v =
      typeof n === "number" && Number.isFinite(n)
        ? Math.floor(n)
        : parseInt(n, 10);
    if (!Number.isFinite(v) || isNaN(v)) return 0;
    return Math.max(0, v);
  }

  function normalizeSymbol(value, fallback) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw.length === 1) {
      const ch = raw;
      if (ch !== "=" && ch !== "|" && ch !== "…" && ch !== " ") return ch;
    }
    return fallback;
  }

  function buildAsciiTimeline(wallet, peer, options) {
    const maxLen =
      options &&
      typeof options.maxLen === "number" &&
      Number.isFinite(options.maxLen)
        ? Math.max(10, Math.floor(options.maxLen))
        : 30;

    const localCount = Array.isArray(wallet && wallet.events)
      ? wallet.events.length
      : 0;
    const commonRaw = clampInt(peer && peer.commonEventCount);
    const common = Math.min(commonRaw, localCount);
    const localDelta = Math.max(0, localCount - common);

    const localSymbol = normalizeSymbol(
      options && typeof options.localSymbol === "string"
        ? options.localSymbol
        : "",
      "L",
    );

    // Compact timeline: fixed common marker, divergence only (local).
    // "=" does not grow with commonEventCount; new events only increase divergence.
    const marker = "===|";
    const available = Math.max(0, maxLen - marker.length);
    let deltaShown = localDelta;
    let prefix = "";
    if (localDelta > available) {
      deltaShown = available;
      // indicate truncation by replacing one "=" with "…": "…==|"
      prefix = "…==|";
    }

    const timeline =
      (prefix ? prefix : marker) + localSymbol.repeat(Math.max(0, deltaShown));
    return "Sync: " + timeline;
  }

  window.dbWalletSync = {
    ensureSyncPeers,
    pickActivePeer,
    computeAgeDays,
    computeTrafficLight,
    buildAsciiTimeline,
  };
})();
