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
  let btnGoExport = null;

  // Canonical list lives in dbWalletHelpers; the literal is only a fallback for
  // the (never-in-practice) case where helpers failed to load.
  const DEVICE_SYMBOLS =
    (window.dbWalletHelpers && window.dbWalletHelpers.DEVICE_SYMBOLS) ||
    ["L", "M", "D", "K", "T", "*"];

  // German date/time like the rest of the UI (toLocaleString() follows the
  // browser locale and gave English dates next to German labels).
  function formatSeen(tsMs) {
    const h = window.dbWalletHelpers;
    if (h && typeof h.formatDateTime === "function") return h.formatDateTime(tsMs);
    return new Date(tsMs).toLocaleString("de-DE");
  }

  function ensureLine() {
    if (!opts) return null;
    if (syncStatusLine && syncStatusLine.isConnected) return syncStatusLine;

    syncStatusLine = document.getElementById("sync-status-line");
    if (!syncStatusLine && opts.topRow && opts.topRow.parentNode) {
      syncStatusLine = document.createElement("section");
      syncStatusLine.id = "sync-status-line";
      syncStatusLine.className = "sync-line panel";
      opts.topRow.insertAdjacentElement("afterend", syncStatusLine);
    }
    return syncStatusLine;
  }

  // P4.7: the line is only shown once there is something to show — a sync
  // partner, i.e. after the first import from another device. A fresh wallet
  // (or one that was only exported) has no partner and no line.
  function setVisible(line, visible) {
    if (line && line.classList) line.classList.toggle("is-visible", !!visible);
  }

  function makeEl(tag, className) {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  }

  function init(nextOpts) {
    opts = nextOpts || null;
    syncLineLevel = "unknown";
    syncLinePeerKey = "";

    const line = ensureLine();
    if (!line) return;

    // Not a live region (P4.1): it is rebuilt on every render, which would
    // re-announce the whole timeline; the status line (#status-text) speaks.
    // The block's heading (#sync-title) stays; only the body is rebuilt.
    const old = line.querySelector ? line.querySelector(".sync-body") : null;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    setVisible(line, false);

    const body = makeEl("div", "sync-body");
    const syncLeft = makeEl("div", "sync-main");
    syncLineText = makeEl("div", "sync-text");
    syncLineTimeline = makeEl("div", "sync-timeline");
    syncLineDelta = makeEl("div", "sync-delta");
    syncLineDelta.hidden = true;
    syncLineLegend = makeEl("div", "sync-legend");
    syncLineLegend.hidden = true;

    const buttons = makeEl("div", "sync-buttons");
    btnGoExport = makeEl("button", "sync-go-export");
    btnGoExport.type = "button";
    btnGoExport.textContent = "Zum Export";
    btnGoExport.hidden = true;
    btnSyncReset = makeEl("button", "sync-reset");
    btnSyncReset.type = "button";
    btnSyncReset.textContent = "✅ passt";
    btnSyncReset.setAttribute("aria-label", "passt: Geräte als gleich bestätigen");

    syncLeft.appendChild(syncLineText);
    syncLeft.appendChild(syncLineTimeline);
    syncLeft.appendChild(syncLineDelta);
    syncLeft.appendChild(syncLineLegend);
    buttons.appendChild(btnGoExport);
    buttons.appendChild(btnSyncReset);
    body.appendChild(syncLeft);
    body.appendChild(buttons);
    line.appendChild(body);

    const openExport = () => {
      if (opts && typeof opts.openExportSection === "function") {
        opts.openExportSection();
      }
    };

    line.addEventListener("click", (e) => {
      if (e && e.target && btnSyncReset && btnSyncReset.contains(e.target)) return;
      if (e && e.target && btnGoExport && btnGoExport.contains(e.target)) return;
      if (syncLineLevel !== "red") return;
      openExport();
    });

    btnGoExport.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      openExport();
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

  function showUnknown(line) {
    syncLineLevel = "unknown";
    syncLinePeerKey = "";
    syncLineText.textContent = "❔ Sync-Status: unbekannt";
    syncLineTimeline.textContent = "Sync: ?";
    syncLineDelta.textContent = "";
    syncLineDelta.hidden = true;
    syncLineLegend.textContent = "";
    syncLineLegend.hidden = true;
    btnGoExport.hidden = true;
    line.title = "";
    line.classList.remove("is-red");
    setVisible(line, false);
  }

  function refresh() {
    const line = ensureLine();
    if (!line || !opts || typeof opts.getWallet !== "function") return;
    if (!syncLineText) return; // init() did not run

    const wallet = opts.getWallet();
    const syncApi = opts.syncApi || null;

    if (!syncApi) {
      showUnknown(line);
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
      showUnknown(line);
      return;
    }

    setVisible(line, true);
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
        syncLineDelta.hidden = false;
      } else {
        syncLineDelta.textContent = "";
        syncLineDelta.hidden = true;
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
        syncLineLegend.hidden = true;
      } else {
        syncLineLegend.innerHTML = "";
        const labelEl = document.createElement("span");
        labelEl.textContent = "Geräte: ";
        syncLineLegend.appendChild(labelEl);
        ordered.forEach((d, idx) => {
          const span = document.createElement("span");
          span.textContent = d.symbol + (idx === ordered.length - 1 ? "" : " ");
          const ts =
            typeof d.lastSeenAt === "number" && Number.isFinite(d.lastSeenAt)
              ? formatSeen(d.lastSeenAt)
              : "";
          span.title = `Geräte-ID: ${d.deviceKey}${ts ? `\nZuletzt gesehen: ${ts}` : ""}`;
          syncLineLegend.appendChild(span);
        });
        syncLineLegend.hidden = false;
      }
    } catch (e) {
      syncLineDelta.textContent = "";
      syncLineDelta.hidden = true;
      syncLineLegend.textContent = "";
      syncLineLegend.hidden = true;
    }

    // Red = stale: the whole line jumps to the export, and "Zum Export" says
    // so visibly (a title tooltip never shows on touch devices).
    const red = syncLineLevel === "red";
    line.classList.toggle("is-red", red);
    btnGoExport.hidden = !red;
    line.title = red ? "Klicken, um zum Export zu springen (für Synchronisierung)" : "";
  }

  window.dbWalletSyncUI = {
    init,
    refresh,
  };
})();
