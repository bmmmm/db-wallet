(function () {
  let opts = null;

  let syncStatusLine = null;
  let syncLineLevel = "unknown"; // "green" | "yellow" | "red" | "unknown"
  let syncLinePeerKey = "";

  let syncLineText = null;
  let syncLineTimeline = null;
  let syncLineDelta = null;
  let syncLineLegend = null;
  let btnSyncReset = null;

  const DEVICE_SYMBOLS = ["L", "M", "D", "K", "T", "*"];

  function ensureLine() {
    if (!opts || !opts.topRow) return null;
    if (syncStatusLine && syncStatusLine.isConnected) return syncStatusLine;

    syncStatusLine = document.getElementById("sync-status-line");
    if (!syncStatusLine && opts.topRow && opts.topRow.parentNode) {
      syncStatusLine = document.createElement("div");
      syncStatusLine.id = "sync-status-line";
      syncStatusLine.className = "top-row";
      syncStatusLine.style.marginTop = "0.75rem";
      opts.topRow.insertAdjacentElement("afterend", syncStatusLine);
    }
    return syncStatusLine;
  }

  function init(nextOpts) {
    opts = nextOpts || null;
    syncLineLevel = "unknown";
    syncLinePeerKey = "";

    const line = ensureLine();
    if (!line) return;

    syncLineText = document.createElement("div");
    syncLineTimeline = document.createElement("div");
    syncLineDelta = document.createElement("div");
    syncLineLegend = document.createElement("div");
    btnSyncReset = document.createElement("button");

    line.innerHTML = "";
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");

    const syncLeft = document.createElement("div");
    syncLeft.style.flex = "1";
    syncLeft.style.minWidth = "220px";

    syncLineText.style.marginBottom = "0.2rem";

    syncLineTimeline.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    syncLineTimeline.style.whiteSpace = "pre";
    syncLineTimeline.style.overflow = "hidden";

    syncLineDelta.style.marginTop = "0.15rem";
    syncLineDelta.style.fontSize = "0.85rem";
    syncLineDelta.style.color = "var(--muted)";
    syncLineDelta.style.display = "none";

    syncLineLegend.style.marginTop = "0.25rem";
    syncLineLegend.style.fontSize = "0.85rem";
    syncLineLegend.style.color = "var(--muted)";
    syncLineLegend.style.display = "none";

    btnSyncReset.textContent = "✅ passt";
    btnSyncReset.style.padding = "0.25rem 0.6rem";
    btnSyncReset.style.fontSize = "0.85rem";
    btnSyncReset.title = "Manuell bestätigen, dass Geräte gleich sind";

    syncLeft.appendChild(syncLineText);
    syncLeft.appendChild(syncLineTimeline);
    syncLeft.appendChild(syncLineDelta);
    syncLeft.appendChild(syncLineLegend);
    line.appendChild(syncLeft);
    line.appendChild(btnSyncReset);

    line.addEventListener("click", (e) => {
      if (e && e.target && btnSyncReset && btnSyncReset.contains(e.target)) return;
      if (syncLineLevel !== "red") return;
      if (opts && typeof opts.openExportSection === "function") {
        opts.openExportSection();
      }
    });

    btnSyncReset.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (!opts || typeof opts.getWallet !== "function") return;
      const wallet = opts.getWallet();
      if (!wallet || !Array.isArray(wallet.events)) return;
      const syncApi = opts.syncApi || null;
      if (!syncApi || typeof syncApi.ensureSyncPeers !== "function") return;

      const peers = syncApi.ensureSyncPeers(wallet);
      const peerKey = syncLinePeerKey || "remote";
      const existing = peers[peerKey];
      const peer =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? existing
          : {};

      if (!peer.label) {
        peer.label =
          existing &&
          typeof existing.label === "string" &&
          existing.label.trim()
            ? existing.label.trim()
            : "Remote";
      }

      peer.updatedAt = Date.now();
      peer.commonEventCount = wallet.events.length;
      peer.peerEventCount = wallet.events.length;
      peers[peerKey] = peer;

      if (opts.saveWallet) opts.saveWallet(wallet);
      refresh();
    });
  }

  function refresh() {
    const line = ensureLine();
    if (!line || !opts || typeof opts.getWallet !== "function") return;

    const wallet = opts.getWallet();
    const syncApi = opts.syncApi || null;

    if (!syncApi) {
      syncLineLevel = "unknown";
      syncLinePeerKey = "";
      syncLineText.textContent = "❔ Sync-Status: unbekannt";
      syncLineTimeline.textContent = "Sync: ?";
      syncLineDelta.textContent = "";
      syncLineDelta.style.display = "none";
      syncLineLegend.textContent = "";
      syncLineLegend.style.display = "none";
      line.title = "";
      line.style.cursor = "default";
      return;
    }

    try {
      if (typeof syncApi.ensureSyncPeers === "function") {
        syncApi.ensureSyncPeers(wallet);
      }
    } catch (e) {
      // ignore
    }

    const active =
      typeof syncApi.pickActivePeer === "function"
        ? syncApi.pickActivePeer(wallet)
        : null;

    if (!active) {
      syncLineLevel = "unknown";
      syncLinePeerKey = "";
      syncLineText.textContent = "❔ Sync-Status: unbekannt";
      syncLineTimeline.textContent = "Sync: ?";
      syncLineDelta.textContent = "";
      syncLineDelta.style.display = "none";
      syncLineLegend.textContent = "";
      syncLineLegend.style.display = "none";
      line.title = "";
      line.style.cursor = "default";
      return;
    }

    syncLinePeerKey = active.peerKey;
    const peer = active.peer;
    const labelRaw = peer && typeof peer.label === "string" ? peer.label.trim() : "";
    const label = labelRaw || syncLinePeerKey || "Remote";

    const ageDays =
      typeof syncApi.computeAgeDays === "function" ? syncApi.computeAgeDays(peer) : null;
    const light =
      typeof syncApi.computeTrafficLight === "function"
        ? syncApi.computeTrafficLight(ageDays)
        : { level: "unknown", icon: "❔" };

    syncLineLevel = light.level || "unknown";
    const daysText =
      typeof ageDays === "number" && Number.isFinite(ageDays)
        ? `${ageDays} ${ageDays === 1 ? "Tag" : "Tage"}`
        : "—";

    if (syncLineLevel === "green") {
      syncLineText.textContent = `${light.icon} Sync aktuell (${daysText} – ${label})`;
    } else if (syncLineLevel === "yellow") {
      syncLineText.textContent = `${light.icon} Sync alt (${daysText} – ${label})`;
    } else if (syncLineLevel === "red") {
      syncLineText.textContent = `${light.icon} Sync veraltet (${daysText} – ${label}) → jetzt synchronisieren`;
    } else {
      syncLineText.textContent = `${light.icon} Sync-Status: unbekannt`;
    }

    const localSymbol =
      opts.getLocalSymbol && typeof opts.getLocalSymbol === "function"
        ? opts.getLocalSymbol()
        : "";

    syncLineTimeline.textContent =
      typeof syncApi.buildAsciiTimeline === "function"
        ? syncApi.buildAsciiTimeline(wallet, peer, { maxLen: 30, localSymbol })
        : "Sync: ?";

    try {
      const common =
        peer &&
        typeof peer.commonEventCount === "number" &&
        Number.isFinite(peer.commonEventCount)
          ? Math.max(0, Math.floor(peer.commonEventCount))
          : 0;
      const localCount = wallet && Array.isArray(wallet.events) ? wallet.events.length : 0;
      const deltaL = Math.max(0, localCount - Math.min(common, localCount));
      if (deltaL > 0) {
        syncLineDelta.textContent = `Δ: +${deltaL} Events`;
        syncLineDelta.style.display = "block";
      } else {
        syncLineDelta.textContent = "";
        syncLineDelta.style.display = "none";
      }

      const devices = wallet && Array.isArray(wallet.devices) ? wallet.devices : [];
      const bySymbol = new Map();
      for (const d of devices) {
        if (!d || typeof d !== "object") continue;
        if (typeof d.symbol === "string" && d.symbol) bySymbol.set(d.symbol, d);
      }
      const ordered = DEVICE_SYMBOLS.map((s) => bySymbol.get(s)).filter(Boolean);
      if (!ordered.length) {
        syncLineLegend.textContent = "";
        syncLineLegend.style.display = "none";
      } else {
        syncLineLegend.innerHTML = "";
        const labelEl = document.createElement("span");
        labelEl.textContent = "Devices: ";
        syncLineLegend.appendChild(labelEl);
        ordered.forEach((d, idx) => {
          const span = document.createElement("span");
          span.textContent = d.symbol + (idx === ordered.length - 1 ? "" : " ");
          const ts =
            typeof d.lastSeenAt === "number" && Number.isFinite(d.lastSeenAt)
              ? new Date(d.lastSeenAt).toLocaleString()
              : "";
          span.title = `Device ID: ${d.deviceKey}${ts ? `\nLast seen: ${ts}` : ""}`;
          syncLineLegend.appendChild(span);
        });
        syncLineLegend.style.display = "block";
      }
    } catch (e) {
      syncLineDelta.textContent = "";
      syncLineDelta.style.display = "none";
      syncLineLegend.textContent = "";
      syncLineLegend.style.display = "none";
    }

    if (syncLineLevel === "red") {
      line.title = "Klicken, um zum Export zu springen (für Synchronisierung)";
      line.style.cursor = "pointer";
    } else {
      line.title = "";
      line.style.cursor = "default";
    }
  }

  window.dbWalletSyncUI = {
    init,
    refresh,
  };
})();
