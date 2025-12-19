(function () {
  const themeApi = window.dbWalletTheme || null;
  const canonicalThemeName =
    themeApi && typeof themeApi.canonicalThemeName === "function"
      ? themeApi.canonicalThemeName
      : (name) => String(name || "").trim();
  const getStoredTheme =
    themeApi && typeof themeApi.getStoredTheme === "function"
      ? themeApi.getStoredTheme
      : () => null;
  const applyThemeRaw =
    themeApi && typeof themeApi.applyTheme === "function"
      ? themeApi.applyTheme
      : () => false;
  const initThemeSelector =
    themeApi && typeof themeApi.initThemeSelector === "function"
      ? themeApi.initThemeSelector
      : () => {};

  function updateCurrentThemeLabel() {
    const el = document.getElementById("current-theme-name");
    if (!el) return;
    const stored = getStoredTheme() || "";
    const attr = String(
      document.documentElement.getAttribute("data-theme") || "",
    ).trim();
    const theme = stored || attr || "Lilac Carbon";
    const canonical = canonicalThemeName(theme);
    el.textContent = canonical || theme || "Lilac Carbon";
  }

  const applyTheme = (name) => {
    const ok = applyThemeRaw(name);
    updateCurrentThemeLabel();
    return ok;
  };

  const helpers = window.dbWalletHelpers || null;
  const storage = window.dbWalletStorage || null;
  const importV2 = window.dbWalletImportV2 || null;
  const summaryApi = window.dbWalletSummary || null;
  const syncApi = window.dbWalletSync || null;
  if (!helpers || !storage || !importV2 || !summaryApi) return;

  const {
    STORAGE_PREFIX,
    randomId,
    randomWalletId,
    base64UrlEncode,
    base64UrlEncodeBytes,
    base64UrlDecode,
    base64UrlDecodeBytes,
    gzipCompress,
    loadRegistry,
    saveRegistry,
    safeParse,
    safeLocalStorageGetItem,
    safeLocalStorageSetItem,
    safeLocalStorageRemoveItem,
  } = helpers;

  const {
    ensureNonReservedUserId,
    getDeviceKey,
    ensureWalletDevices,
    getLocalDeviceSymbol,
    setLocalDeviceSymbol,
    touchLocalDevice,
    parseCompactEventId,
    ensureDeviceSeq,
    nextEventId,
    loadWallet,
    saveWallet,
    getAllWallets,
  } = storage;

  const { encodeImportV2Bytes, tryImportFromHash } = importV2;

  const {
    todayDateStr,
    dateStrFromTimestamp,
    computeSummary,
    parseDeleteRange,
    formatLogLine,
  } = summaryApi;

  let redirectedToPreview = false;

  function getUserIdFromHash() {
    const hash = window.location.hash.slice(1);
    if (
      !hash ||
      hash.startsWith("import:") ||
      hash.startsWith("i2:") ||
      hash.startsWith("i2u:") ||
      hash.startsWith("ac:")
    ) {
      return null;
    }
    return hash;
  }

  async function ensureUserId() {
    const importedRes = await tryImportFromHash({ applyTheme });
    if (importedRes && importedRes.userId) return importedRes.userId;
    if (importedRes && importedRes.redirectedToPreview) {
      redirectedToPreview = true;
      return null;
    }

    let userId = getUserIdFromHash();
    if (userId) {
      const ensured = ensureNonReservedUserId(userId);
      if (ensured !== userId) {
        userId = ensured;
        window.location.hash = "#" + userId;
      }
    } else {
      userId = "user-" + randomId();
      window.location.hash = "#" + userId;
    }
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

  document.addEventListener("DOMContentLoaded", async () => {
    const elUid = document.getElementById("uid");
    const elWalletVersion = document.getElementById("wallet-version");
    const elTotal = document.getElementById("total");
    const elUnpaid = document.getElementById("unpaid");
    const elCredit = document.getElementById("credit");
    const elAmount = document.getElementById("amount");
    const elExportUrl = document.getElementById("export-url");
    const qrBox = document.getElementById("qr-box");
    const qrHint = document.getElementById("qr-hint");
    const qrCanvas = document.getElementById("qr-canvas");
    const qrUrl = document.getElementById("qr-url");
    const topRow = document.querySelector(".top-row");
    let syncStatusLine = document.getElementById("sync-status-line");
    const actionCodesPanel = document.getElementById("action-codes-panel");
    const actionCodesBody = document.getElementById("action-codes-body");
    const elHistory = document.getElementById("history");
    const elDeleteRange = document.getElementById("delete-range");
    const logTools = document.getElementById("log-tools");
    const logEditGroup = document.getElementById("log-edit-group");
    const rawToggle = document.querySelector(".raw-toggle");
    const logEditToggle = document.getElementById("log-edit-toggle");

    const btnHome = document.getElementById("btn-home");
    const btnInfo = document.getElementById("btn-info");
    const btnMigrate = document.getElementById("btn-migrate");
    const btnDrink = document.getElementById("btn-drink");
    const btnUndo = document.getElementById("btn-undo");
    const btnPay = document.getElementById("btn-pay");
    const payOptions = document.getElementById("pay-options");
    const btnPayToday = document.getElementById("btn-pay-today");
    const btnCredit = document.getElementById("btn-credit");
    const btnPayCancel = document.getElementById("btn-pay-cancel");
    const btnExport = document.getElementById("btn-export");
    const exportOptions = document.getElementById("export-options");
    const btnExportLink = document.getElementById("btn-export-link");
    const btnExportLinkQr = document.getElementById("btn-export-link-qr");
    const btnExportJson = document.getElementById("btn-export-json");
    const btnReset = document.getElementById("btn-reset");
    const btnModeDiagram = document.getElementById("mode-diagram");
    const btnModeLog = document.getElementById("mode-log");
    const btnModeRaw = document.getElementById("mode-raw");
    const btnEditEntry = document.getElementById("btn-edit-entry");
    const btnSelectionDelete = document.getElementById("btn-selection-delete");
    const btnRawCurrent = document.getElementById("raw-scope-current");
    const btnRawAll = document.getElementById("raw-scope-all");

    const requiredEls = [
      elUid,
      elTotal,
      elUnpaid,
      elAmount,
      elHistory,
      btnDrink,
      btnUndo,
      btnPay,
      btnReset,
    ];
    if (requiredEls.some((el) => !el)) return;

    initThemeSelector();
    updateCurrentThemeLabel();
    const themeButtons = document.getElementById("theme-buttons");
    if (themeButtons) {
      themeButtons.addEventListener("click", (e) => {
        const btn =
          e && e.target && typeof e.target.closest === "function"
            ? e.target.closest(".theme-btn")
            : null;
        if (!btn) return;
        setTimeout(updateCurrentThemeLabel, 0);
      });
    }

    if (!syncStatusLine && topRow && topRow.parentNode) {
      // created by wallet-sync-ui.js
    }

    const deviceUi = window.dbWalletDeviceUI || null;
    const syncUi = window.dbWalletSyncUI || null;
    const exportUi = window.dbWalletExportUI || null;
    const historyUi = window.dbWalletHistoryUI || null;

    let userId = await ensureUserId();
    if (redirectedToPreview || !userId) return;
    let wallet = loadWallet(userId);
    ensureDeviceSeq(wallet);
    try {
      if (typeof touchLocalDevice === "function") touchLocalDevice(wallet);
    } catch (e) {
      // ignore
    }
    saveWallet(wallet);

    let summaryCache = null;
    let actionCodesUi = null;
    try {
      const actionApi = window.dbWalletActionCodes || null;
      if (actionApi && typeof actionApi.initActionCodesUi === "function") {
        actionCodesUi = actionApi.initActionCodesUi({
          container: actionCodesBody,
          getWallet: () => wallet,
          persistWallet: (next) => {
            wallet = next;
            saveWallet(wallet);
          },
          getBaseUrl,
        });
      }
    } catch (e) {
      // ignore
    }

    const invalidateCaches = () => {
      summaryCache = null;
      if (historyUi) historyUi.invalidateCache();
    };

    const getSummary = () => {
      if (!summaryCache) {
        summaryCache = computeSummary(wallet);
      }
      return summaryCache;
    };

    const deviceKey = getDeviceKey();

    function updateUidLabel() {
      if (elUid) {
        elUid.textContent = userId;
        elUid.title = "";
      }
      if (deviceUi && typeof deviceUi.render === "function") {
        deviceUi.render();
      }
    }

    if (deviceUi && typeof deviceUi.init === "function") {
      deviceUi.init({
        elUid,
        getDeviceKey: () => deviceKey,
        getDeviceSymbol: () =>
          typeof getLocalDeviceSymbol === "function"
            ? getLocalDeviceSymbol(wallet)
            : "",
        setDeviceSymbol: (sym) => {
          const ok =
            typeof setLocalDeviceSymbol === "function"
              ? setLocalDeviceSymbol(wallet, sym)
              : false;
          if (ok) saveWallet(wallet);
          return ok;
        },
        onChange: () => {
          if (syncUi && typeof syncUi.refresh === "function") syncUi.refresh();
        },
      });
    }

    if (exportUi && typeof exportUi.init === "function") {
      exportUi.init({
        refs: {
          btnExport,
          exportOptions,
          btnExportLink,
          btnExportLinkQr,
          btnExportJson,
          elExportUrl,
          qrBox,
          qrHint,
          qrCanvas,
          qrUrl,
        },
        getWallet: () => wallet,
        saveWallet: (w) => saveWallet(w),
        encodeImportV2Bytes,
        gzipCompress,
        base64UrlEncode,
        base64UrlEncodeBytes,
        todayDateStr,
        needsMigration,
        runMigrationDialog,
        loadRegistry,
        safeParse,
        getStoredTheme,
        actionCodesUi,
        touchLocalDevice: () => {
          try {
            if (typeof touchLocalDevice === "function") {
              if (touchLocalDevice(wallet)) saveWallet(wallet);
            }
          } catch (e) {
            // ignore
          }
        },
        downloadCurrentWalletBackup,
      });
    }

    if (syncUi && typeof syncUi.init === "function") {
      syncUi.init({
        topRow,
        getWallet: () => wallet,
        saveWallet: (w) => saveWallet(w),
        getDeviceKey: () => deviceKey,
        getLocalSymbol: () =>
          (typeof getLocalDeviceSymbol === "function"
            ? getLocalDeviceSymbol(wallet)
            : "") || "_",
        parseCompactEventId,
        syncApi,
        openExportSection: () => {
          if (exportUi && typeof exportUi.openSection === "function") {
            exportUi.openSection();
          }
        },
      });
    }

    if (historyUi && typeof historyUi.init === "function") {
      historyUi.init({
        refs: {
          elHistory,
          logTools,
          logEditGroup,
          rawToggle,
          logEditToggle,
          btnModeDiagram,
          btnModeLog,
          btnModeRaw,
          btnRawCurrent,
          btnRawAll,
        },
        getWallet: () => wallet,
        getSummary,
        getAllWallets,
        onAfterRender: () => {
          if (syncUi && typeof syncUi.refresh === "function") {
            syncUi.refresh();
          }
        },
      });
    }

    updateUidLabel();
    elExportUrl.value = ""; // initial leer

    function openExportSection() {
      if (exportUi && typeof exportUi.openSection === "function") {
        exportUi.openSection();
      }
    }

    function clearExport() {
      if (exportUi && typeof exportUi.clear === "function") {
        exportUi.clear();
      }
    }

    function getWalletVersion() {
      return wallet && typeof wallet.v === "number" ? wallet.v : 1;
    }

    function needsMigration() {
      try {
        if (typeof window.dbWalletNeedsMigration === "function") {
          return window.dbWalletNeedsMigration(wallet);
        }
      } catch (e) {
        // ignore
      }
      return getWalletVersion() < 2;
    }

    function updateHeaderUi() {
      if (elWalletVersion) {
        elWalletVersion.textContent = `v${getWalletVersion()}`;
      }
      if (btnMigrate) {
        btnMigrate.style.display = needsMigration() ? "inline-block" : "none";
      }
    }

    function resetAmount() {
      elAmount.value = "1";
    }

    function getBaseUrl() {
      const href = String(window.location.href || "");
      const idx = href.indexOf("#");
      return idx >= 0 ? href.slice(0, idx) : href;
    }

    function exportJsonData() {
      const theme = getStoredTheme();
      try {
        const actionApi = window.dbWalletActionCodes || null;
        if (
          actionApi &&
          typeof actionApi.ensureWalletActionCodes === "function"
        ) {
          const res = actionApi.ensureWalletActionCodes(wallet);
          if (res && res.changed) saveWallet(wallet);
        }
      } catch (e) {
        // ignore
      }
      try {
        if (typeof touchLocalDevice === "function") {
          if (touchLocalDevice(wallet)) saveWallet(wallet);
        }
      } catch (e) {
        // ignore
      }
      return {
        userId: wallet.userId,
        walletId: wallet.walletId,
        deviceId: wallet.deviceId,
        v: wallet.v,
        seq: wallet.seq,
        events: wallet.events,
        actionCodes: wallet.actionCodes,
        devices: wallet.devices,
        theme,
      };
    }

    async function switchToUser(nextUserId) {
      let target = String(nextUserId || "").trim();
      if (!target) return false;

      const ensured = ensureNonReservedUserId(target);
      if (ensured !== target) {
        target = ensured;
        if (window.location.hash.slice(1) !== target) {
          window.location.hash = "#" + target;
        }
      }

      userId = target;
      wallet = loadWallet(userId);
      ensureDeviceSeq(wallet);
      try {
        if (typeof touchLocalDevice === "function") touchLocalDevice(wallet);
      } catch (e) {
        // ignore
      }
      saveWallet(wallet);
      invalidateCaches();
      clearExport();
      refreshSummary();
      if (actionCodesUi) actionCodesUi.refresh();
      updateHeaderUi();
      updateUidLabel();
      return true;
    }

    let handlingHash = false;
    async function handleHashChange() {
      if (handlingHash) return;
      handlingHash = true;
      try {
        const hash = window.location.hash.slice(1);
        if (!hash) return;

        if (
          hash.startsWith("ac:") ||
          hash.startsWith("import:") ||
          hash.startsWith("i2:") ||
          hash.startsWith("i2u:")
        ) {
          const res = await tryImportFromHash({
            applyTheme,
            returnToUserId:
              wallet && typeof wallet.userId === "string" ? wallet.userId : "",
          });
          if (res && res.redirectedToPreview) return;
          const next = res && typeof res.userId === "string" ? res.userId : "";
          if (next) {
            await switchToUser(next);
          }
          return;
        }

        await switchToUser(hash);
      } catch (e) {
        // ignore
        if (userId && window.location.hash.slice(1) !== userId) {
          window.location.hash = "#" + userId;
        }
      } finally {
        handlingHash = false;
      }
    }
    window.addEventListener("hashchange", () => {
      handleHashChange();
    });

    function downloadJsonFile(data, filename) {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }

    function downloadCurrentWalletBackup(tag) {
      const date = todayDateStr();
      const safeUserId = String(wallet.userId || "user").replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      );
      const suffix = tag ? `-${tag}` : "";
      downloadJsonFile(
        exportJsonData(),
        `db-wallet-${safeUserId}-${date}${suffix}.json`,
      );
    }

    function migrateWalletNow() {
      if (typeof window.dbWalletMigrateV1toV2 !== "function") {
        alert("Migration ist nicht verfügbar (migration.js fehlt).");
        return false;
      }
      wallet = window.dbWalletMigrateV1toV2(wallet);
      ensureDeviceSeq(wallet);
      saveWallet(wallet);
      invalidateCaches();
      clearExport();
      refreshSummary();
      updateHeaderUi();
      return true;
    }

    function runMigrationDialog(reason, force) {
      const header =
        reason ||
        "Dein Wallet ist noch v1. Für einen zuverlässigen QR-Export empfiehlt sich die Migration auf v2.";
      const text =
        header +
        "\n\n1 = Direkt migrieren\n2 = Lokal abspeichern & migrieren\n\nAbbrechen = kein QR-Export";
      while (true) {
        const choice = window.prompt(text, "1");
        if (choice === null) return false;
        const c = String(choice).trim();
        if (c === "1") return migrateWalletNow();
        if (c === "2") {
          downloadCurrentWalletBackup("backup");
          return migrateWalletNow();
        }
        if (!force) return false;
      }
    }

    if (btnMigrate) {
      btnMigrate.addEventListener("click", () => {
        if (!needsMigration()) return;
        runMigrationDialog("", false);
      });
    }

    updateHeaderUi();
    refreshSummary();

    function getAmount() {
      const n = parseInt(elAmount.value, 10);
      return isNaN(n) || n <= 0 ? 1 : n;
    }

    // Setzt das Zahlungs-UI zentral zurück
    function resetPayUi() {
      if (payOptions) {
        payOptions.style.display = "none";
      }
      if (btnPayToday) {
        btnPayToday.textContent = "heute bezahlen 💰";
      }
      if (btnPay) {
        btnPay.style.display = "inline-block";
      }
      if (btnUndo) {
        btnUndo.style.display = "inline-block";
      }
      if (btnDrink) {
        btnDrink.style.display = "inline-block";
      }
    }

    function refreshSummary() {
      const summary = getSummary();
      elTotal.textContent = summary.total;
      elUnpaid.textContent = summary.unpaid;
      if (elCredit) {
        elCredit.textContent = summary.credit;
      }

      if (syncUi && typeof syncUi.refresh === "function") {
        syncUi.refresh();
      }
      if (historyUi && typeof historyUi.render === "function") {
        historyUi.render();
      }
    }

    btnHome.addEventListener("click", () => {
      window.location.href = "index.html";
    });
    if (btnInfo) {
      btnInfo.addEventListener("click", () => {
        window.open("https://github.com/bmmmm/db-wallet", "_blank");
      });
    }

    btnDrink.addEventListener("click", () => {
      const n = getAmount();
      wallet.events.push(newEvent(wallet, "d", n));
      saveWallet(wallet);
      invalidateCaches();
      resetAmount();
      clearExport();
      refreshSummary();
    });

    btnUndo.addEventListener("click", () => {
      const summaryBefore = getSummary();
      const events = summaryBefore.eventsSorted || [];
      const deviceKey = getDeviceKey();

      function isUndoable(e) {
        return e && (e.t === "d" || e.t === "s");
      }

      let target = null;
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (!isUndoable(e)) continue;
        const parsed = parseCompactEventId(e.id);
        if (parsed && parsed.deviceKey === deviceKey) {
          target = e;
          break;
        }
      }
      if (!target) {
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i];
          if (isUndoable(e)) {
            target = e;
            break;
          }
        }
      }

      if (!target) {
        alert("Keine Buchung zum Rückgängig machen 🤷");
        resetAmount();
        clearExport();
        return;
      }

      const n =
        typeof target.n === "number" && isFinite(target.n)
          ? Math.max(1, Math.round(target.n))
          : 1;
      const inverseType = target.t === "d" ? "s" : "d";

      wallet.events.push(newEvent(wallet, inverseType, n));
      saveWallet(wallet);
      invalidateCaches();
      resetAmount();
      clearExport();
      refreshSummary();
    });

    btnPay.addEventListener("click", () => {
      if (!payOptions) return;
      // Toggle Sichtbarkeit der Zahlungsoptionen
      if (
        payOptions.style.display === "none" ||
        payOptions.style.display === ""
      ) {
        payOptions.style.display = "flex";
        // Während des Zahlungsvorgangs Bezahlen-, Rückgängig- und Trinken-Button ausblenden
        if (btnPay) btnPay.style.display = "none";
        if (btnUndo) btnUndo.style.display = "none";
        if (btnDrink) btnDrink.style.display = "none";
      } else {
        // Zahlungsvorgang abbrechen/zuklappen -> UI zurücksetzen
        resetPayUi();
      }
    });

    if (btnPayToday) {
      btnPayToday.addEventListener("click", () => {
        const summaryBefore = getSummary();

        if (summaryBefore.unpaid <= 0) {
          alert("Keine offenen Getränke zum Bezahlen.");
          clearExport();
          return;
        }

        // Normale Zahlung für offene Getränke (heute)
        wallet.events.push(newEvent(wallet, "p"));
        saveWallet(wallet);
        invalidateCaches();
        resetAmount();
        clearExport();
        resetPayUi();
        refreshSummary();
      });
    }

    if (btnPayCancel) {
      btnPayCancel.addEventListener("click", () => {
        clearExport();
        resetPayUi();
      });
    }

    if (btnCredit) {
      btnCredit.addEventListener("click", () => {
        const amountStr = prompt(
          "Wie viele Getränke möchtest du als Guthaben buchen?",
          "10",
        );
        if (amountStr === null) {
          clearExport();
          return;
        }
        const n = parseInt(amountStr, 10);
        if (isNaN(n) || n <= 0) {
          alert("Ungültige Menge für die Gutschrift.");
          clearExport();
          return;
        }
        wallet.events.push(newEvent(wallet, "g", n));
        saveWallet(wallet);
        invalidateCaches();
        resetAmount();
        clearExport();
        resetPayUi();
        refreshSummary();
      });
    }

    btnReset.addEventListener("click", () => {
      if (!confirm(`Wirklich alle Getränkedaten für "${userId}" löschen? 🗑️`))
        return;
      safeLocalStorageRemoveItem(STORAGE_PREFIX + wallet.userId);
      if (
        typeof wallet.userId === "string" &&
        wallet.userId &&
        !wallet.userId.includes(":")
      ) {
        safeLocalStorageRemoveItem(wallet.userId);
      }
      wallet = {
        userId: wallet.userId,
        walletId: wallet.walletId || randomWalletId(),
        deviceId: wallet.deviceId || randomId(),
        v: 2,
        seq: {},
        events: [],
        actionCodes: [],
      };
      saveWallet(wallet);
      if (actionCodesUi) actionCodesUi.refresh();
      invalidateCaches();
      clearExport();
      elHistory.textContent = "Noch keine Drinks geloggt. ✨";
      elDeleteRange.value = "";
      resetAmount();
      updateHeaderUi();
      refreshSummary();
    });

    btnSelectionDelete.addEventListener("click", () => {
      const summary = getSummary();
      const maxIndex = summary.eventsSorted.length;
      if (maxIndex === 0) {
        alert(`Keine Logeinträge für "${userId}" vorhanden.`);
        clearExport();
        elDeleteRange.value = "";
        return;
      }

      const input = elDeleteRange.value.trim();
      const indices = parseDeleteRange(input, maxIndex);

      if (!indices.size) {
        alert("Keine gültigen IDs im Eingabefeld gefunden.");
        clearExport();
        elDeleteRange.value = "";
        return;
      }

      const idsToDelete = new Set();
      let payCount = 0;

      summary.eventsSorted.forEach((e, i) => {
        const idx = i + 1;
        if (indices.has(idx)) {
          idsToDelete.add(e.id);
          if (e.t === "p") payCount++;
        }
      });

      if (!idsToDelete.size) {
        alert("Keine passenden Logeinträge gefunden.");
        clearExport();
        elDeleteRange.value = "";
        return;
      }

      let msg = `Wirklich ${idsToDelete.size} Logeintrag/Einträge für "${userId}" löschen? 🧹`;
      if (payCount > 0) {
        msg += `\nAchtung: Darunter sind ${payCount} Zahlung(en) 💸.`;
      }

      if (!confirm(msg)) return;

      wallet.events = wallet.events.filter((e) => !idsToDelete.has(e.id));
      saveWallet(wallet);
      invalidateCaches();
      clearExport();
      elDeleteRange.value = "";
      refreshSummary();
    });

    if (btnEditEntry) {
      btnEditEntry.addEventListener("click", () => {
        const summary = getSummary();
        const maxIndex = summary.eventsSorted.length;
        if (maxIndex === 0) {
          alert(`Keine Logeinträge für "${userId}" vorhanden.`);
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        const input = elDeleteRange.value.trim();
        const indices = parseDeleteRange(input, maxIndex);

        if (!indices.size) {
          alert("Bitte genau eine ID angeben, die bearbeitet werden soll.");
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        if (indices.size > 1) {
          alert("Bearbeitung funktioniert nur mit genau einer ID.");
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        const targetIndex = Array.from(indices)[0]; // 1-basiert
        const targetEvent = summary.eventsSorted[targetIndex - 1];
        if (!targetEvent) {
          alert(
            "Die ausgewählte ID konnte keinem Logeintrag zugeordnet werden.",
          );
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        const currentDateStr = dateStrFromTimestamp(targetEvent.ts);
        const newDateStr = prompt(
          `Neues Datum für Eintrag #${targetIndex} (YYYY-MM-DD):`,
          currentDateStr,
        );
        if (newDateStr === null) {
          // Abgebrochen
          clearExport();
          elDeleteRange.value = "";
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateStr)) {
          alert("Ungültiges Datumsformat. Erwartet wird YYYY-MM-DD.");
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        // Datum mit aktueller Uhrzeit kombinieren
        const now = new Date();
        const parts = newDateStr.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // 0-basiert
        const day = parseInt(parts[2], 10);
        const testDate = new Date(
          year,
          month,
          day,
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
          now.getMilliseconds(),
        );
        if (isNaN(testDate.getTime())) {
          alert("Ungültiges Datum.");
          clearExport();
          elDeleteRange.value = "";
          return;
        }

        let newAmount = targetEvent.n;
        if (targetEvent.t !== "p") {
          const defaultAmount =
            typeof targetEvent.n === "number" ? targetEvent.n : 1;
          const amountStr = prompt(
            `Neue Menge für Eintrag #${targetIndex}:`,
            String(defaultAmount),
          );
          if (amountStr === null) {
            clearExport();
            elDeleteRange.value = "";
            return;
          }
          const parsed = parseInt(amountStr, 10);
          if (isNaN(parsed) || parsed <= 0) {
            alert("Ungültige Menge.");
            clearExport();
            elDeleteRange.value = "";
            return;
          }
          newAmount = parsed;
        }

        const newTs = testDate.getTime();
        const targetId = targetEvent.id;

        wallet.events = wallet.events.map((e) => {
          if (e.id === targetId) {
            return {
              ...e,
              ts: newTs,
              n: e.t === "p" ? undefined : newAmount,
            };
          }
          return e;
        });

        saveWallet(wallet);
        invalidateCaches();
        clearExport();
        elDeleteRange.value = "";
        refreshSummary();
      });
    }
  });
})();
