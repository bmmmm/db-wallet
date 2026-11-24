(function () {
  const helpers = window.dbWalletHelpers;
  if (!helpers) return;

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

  // Runs once per page; #sync-status-line (with its heading #sync-title)
  // stands in wallet.html, the body below the heading is built here.
  function init(nextOpts) {
    opts = nextOpts || null;
    const line = document.getElementById("sync-status-line");
    if (!opts || !line) return;
    syncStatusLine = line;

    // Not a live region (P4.1): it is rebuilt on every render, which would
    // re-announce the whole timeline; the status line (#status-text) speaks.
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
      if (typeof opts.openExportSection === "function") opts.openExportSection();
    };

    // The buttons stop their clicks, so this is a click on the line itself.
    line.addEventListener("click", () => {
      if (syncLineLevel === "red") openExport();
    });

    btnGoExport.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      openExport();
    });

    btnSyncReset.addEventListener("click", (e) => {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      const wallet = opts.getWallet();
      const syncApi = opts.syncApi;
      if (!syncApi || !wallet || !Array.isArray(wallet.events)) return;

      const peers = syncApi.ensureSyncPeers(wallet);
      const peerKey = syncLinePeerKey || "remote";
      const existing = peers[peerKey];
      const peer =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? existing
          : {};
      if (!peer.label) peer.label = "Remote";
      peer.updatedAt = Date.now();
      peer.commonEventCount = wallet.events.length;
      peers[peerKey] = peer;

      opts.saveWallet(wallet);
      refresh();
    });
  }

  // No partner (yet): the line stays hidden, its content is not updated.
  function hide(line) {
    syncLineLevel = "unknown";
    syncLinePeerKey = "";
    setVisible(line, false);
  }

  function refresh() {
    const line = syncStatusLine;
    if (!line || !syncLineText) return; // init() did not run

    const wallet = opts.getWallet();
    const syncApi = opts.syncApi || null;
    if (!syncApi) {
      hide(line);
      return;
    }

    syncApi.ensureSyncPeers(wallet);
    // pickActivePeer only returns a peer with updatedAt > 0, so ageDays is
    // a number and the light is green, yellow or red.
    const active = syncApi.pickActivePeer(wallet);
    if (!active) {
      hide(line);
      return;
    }

    setVisible(line, true);
    syncLinePeerKey = active.peerKey;
    const peer = active.peer;
    const labelRaw = typeof peer.label === "string" ? peer.label.trim() : "";
    const label = labelRaw || syncLinePeerKey;

    const ageDays = syncApi.computeAgeDays(peer);
    const light = syncApi.computeTrafficLight(ageDays);
    syncLineLevel = light.level;
    const daysText = `${ageDays} ${ageDays === 1 ? "Tag" : "Tage"}`;

    if (syncLineLevel === "green") {
      syncLineText.textContent = `${light.icon} Sync aktuell (${daysText} – ${label})`;
    } else if (syncLineLevel === "yellow") {
      syncLineText.textContent = `${light.icon} Sync alt (${daysText} – ${label})`;
    } else {
      syncLineText.textContent = `${light.icon} Sync veraltet (${daysText} – ${label}) → jetzt synchronisieren`;
    }

    const localSymbol =
      typeof opts.getLocalSymbol === "function" ? opts.getLocalSymbol() : "";
    syncLineTimeline.textContent = syncApi.buildAsciiTimeline(wallet, peer, {
      maxLen: 30,
      localSymbol,
    });

    try {
      const common =
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
      const ordered = helpers.DEVICE_SYMBOLS.map((s) => bySymbol.get(s)).filter(Boolean);
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
              ? helpers.formatDateTime(d.lastSeenAt)
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
