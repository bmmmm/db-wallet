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
  const hashRouter = window.dbWalletHashRouter || null;
  if (!helpers || !storage || !importV2 || !summaryApi) return;

  const {
    base64UrlEncode,
    base64UrlEncodeBytes,
    gzipCompress,
    loadRegistry,
    safeParse,
  } = helpers;

  const {
    ensureNonReservedUserId,
    getDeviceKey,
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

  const { todayDateStr, computeSummary } = summaryApi;

  let redirectedToPreview = false;
  let lastHandledGlobalHash = "";
  let lastHandledGlobalHashAt = 0;
  const GLOBAL_ACTION_DUP_WINDOW_MS = 750;
  const LAST_USER_KEY = "db-wallet:last-user";

  function replaceHashSilently(nextHash) {
    const target = String(nextHash || "").trim();
    if (!target) return false;
    const current = window.location.hash.slice(1);
    if (current === target) return true;
    if (window.history && typeof window.history.replaceState === "function") {
      const base = String(window.location.href || "").split("#")[0];
      window.history.replaceState(null, "", base + "#" + target);
      return true;
    }
    return false;
  }

  function isDuplicateGlobalActionHash(hash) {
    if (!hash) return false;
    if (hash !== lastHandledGlobalHash) return false;
    return Date.now() - lastHandledGlobalHashAt < GLOBAL_ACTION_DUP_WINDOW_MS;
  }

  function markGlobalActionHandled(hash) {
    lastHandledGlobalHash = String(hash || "");
    lastHandledGlobalHashAt = Date.now();
    if (
      typeof document !== "undefined" &&
      document &&
      document.body &&
      lastHandledGlobalHash
    ) {
      document.body.dataset.lastGlobalAction = lastHandledGlobalHash;
    }
  }

  function getLastUserId() {
    try {
      if (typeof sessionStorage === "undefined" || !sessionStorage) return "";
      const stored = sessionStorage.getItem(LAST_USER_KEY);
      return typeof stored === "string" ? stored : "";
    } catch (e) {
      return "";
    }
  }

  function setLastUserId(userId) {
    const value = String(userId || "").trim();
    if (!value) return;
    try {
      if (typeof sessionStorage === "undefined" || !sessionStorage) return;
      sessionStorage.setItem(LAST_USER_KEY, value);
    } catch (e) {
      // ignore
    }
  }

  function classifyHashValue(raw) {
    if (hashRouter && typeof hashRouter.classifyHash === "function") {
      return hashRouter.classifyHash(raw);
    }
    return { kind: "none" };
  }

  async function resolveInitialUserId() {
    const route = classifyHashValue(window.location.hash.slice(1));
    if (route.kind === "globalAction" || route.kind === "none") return null;
    const importedRes = await tryImportFromHash({ applyTheme });
    if (importedRes && importedRes.userId) return importedRes.userId;
    if (importedRes && importedRes.redirectedToPreview) {
      redirectedToPreview = true;
      return null;
    }
    if (route.kind !== "user") return null;

    let userId = route.userId;
    const ensured = ensureNonReservedUserId(userId);
    if (ensured !== userId) {
      userId = ensured;
      replaceHashSilently(userId);
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

    const hashActions = window.dbWalletHashActions || null;

    function showGlobalActionMessage(message) {
      if (hashActions && typeof hashActions.showMessage === "function") {
        return hashActions.showMessage(message);
      }
      return null;
    }

    function setNoWalletState() {
      if (hashActions && typeof hashActions.setNoWalletState === "function") {
        hashActions.setNoWalletState();
      }
    }

    function clearNoWalletState() {
      if (hashActions && typeof hashActions.clearNoWalletState === "function") {
        hashActions.clearNoWalletState();
      }
    }

    function awaitGlobalActionWalletSelection(options) {
      if (
        hashActions &&
        typeof hashActions.awaitGlobalActionWalletSelection === "function"
      ) {
        return hashActions.awaitGlobalActionWalletSelection(options);
      }
      return Promise.resolve({ action: "cancel", userId: "" });
    }

    const initialHash = window.location.hash.slice(1);
    const initialRoute = classifyHashValue(initialHash);
    const initialKind =
      initialRoute.kind === "globalAction"
        ? "globalActionNeedsWallet"
        : initialRoute.kind;

    let initialUserId = "";
    let initialWallet = null;
    let pendingGlobalHash = "";

    if (initialKind === "globalActionNeedsWallet") {
      const wallets = getAllWallets ? getAllWallets() : {};
      const userIds = Object.keys(wallets).sort((a, b) => a.localeCompare(b));
      const actionApi = window.dbWalletActionCodes || null;
      const payload =
        actionApi && typeof actionApi.decodeGlobalActionHash === "function"
          ? actionApi.decodeGlobalActionHash(initialRoute.raw || "")
          : null;
      const lastUserId = getLastUserId();
      const walletMeta = {};

      userIds.forEach((id) => {
        const w = wallets[id];
        const walletId = w && typeof w.walletId === "string" ? w.walletId : "";
        const walletIdSnippet =
          walletId && walletId.length > 8
            ? `${walletId.slice(0, 4)}…${walletId.slice(-4)}`
            : walletId;
        const eventCount = Array.isArray(w && w.events) ? w.events.length : 0;
        walletMeta[id] = {
          walletIdSnippet,
          eventCount,
        };
      });

      if (userIds.length === 0) {
        setNoWalletState();
        showGlobalActionMessage(
          "Bitte zuerst ein Wallet importieren oder öffnen.",
        );
        return;
      }

      pendingGlobalHash = initialRoute.raw || "";
      if (userIds.length === 1) {
        initialUserId = userIds[0];
        initialWallet = wallets[initialUserId] || null;
      } else {
        const selection = await awaitGlobalActionWalletSelection({
          userIds,
          payload,
          walletMeta,
          lastUserId,
        });
        if (!selection || selection.action === "cancel") {
          pendingGlobalHash = "";
          const fallback =
            selection && selection.userId ? selection.userId : "";
          if (fallback && wallets[fallback]) {
            initialUserId = fallback;
            initialWallet = wallets[fallback] || null;
            replaceHashSilently(fallback);
          } else {
            setNoWalletState();
            showGlobalActionMessage(
              "Bitte zuerst ein Wallet importieren oder öffnen.",
            );
            return;
          }
        } else {
          initialUserId = selection.userId;
          initialWallet = wallets[selection.userId] || null;
        }
      }
    }

    if (initialKind === "none") {
      setNoWalletState();
      showGlobalActionMessage(
        "Bitte zuerst ein Wallet importieren oder öffnen.",
      );
      return;
    }

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

    let userId = initialUserId || (await resolveInitialUserId());
    if (redirectedToPreview || !userId) return;
    let wallet = initialWallet || loadWallet(userId);
    if (!wallet) {
      setNoWalletState();
      showGlobalActionMessage(
        "Bitte zuerst ein Wallet importieren oder öffnen.",
      );
      return;
    }

    if (pendingGlobalHash) {
      const result = handleGlobalActionHash(pendingGlobalHash, {
        wallet,
        skipPersist: true,
        skipHashCleanup: true,
      });
      if (result && result.applied) {
        replaceHashSilently(userId);
      }
    }
    setLastUserId(userId);
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
        // Use replaceState (like every other nav path) instead of assigning
        // location.hash, which would fire a redundant re-entrant hashchange.
        if (window.location.hash.slice(1) !== target) {
          replaceHashSilently(target);
        }
      }

      userId = target;
      setLastUserId(userId);
      wallet = loadWallet(userId);
      ensureDeviceSeq(wallet);
      try {
        if (typeof touchLocalDevice === "function") touchLocalDevice(wallet);
      } catch (e) {
        // ignore
      }
      saveWallet(wallet);
      handleWalletStateChange();
      if (actionCodesUi) actionCodesUi.refresh();
      updateHeaderUi();
      updateUidLabel();
      return true;
    }

    function handleGlobalActionHash(hash, options = {}) {
      if (isDuplicateGlobalActionHash(hash)) {
        return { handled: true, applied: false, reason: "duplicate" };
      }
      const actionApi = window.dbWalletActionCodes || null;
      const payload =
        actionApi && typeof actionApi.decodeGlobalActionHash === "function"
          ? actionApi.decodeGlobalActionHash(hash)
          : null;
      const skipMessage = !!options.skipMessage;

      if (!payload) {
        if (!skipMessage) {
          showGlobalActionMessage(
            "Bitte zuerst ein Wallet importieren oder öffnen.",
          );
        }
        return { handled: true, applied: false, reason: "invalid" };
      }

      const targetWallet = "wallet" in options ? options.wallet : wallet;
      if (!targetWallet) {
        if (!skipMessage) {
          showGlobalActionMessage(
            "Bitte zuerst ein Wallet importieren oder öffnen.",
          );
        }
        return { handled: true, applied: false, reason: "no-wallet" };
      }
      if (!Array.isArray(targetWallet.events)) targetWallet.events = [];

      const type = payload.t === "d" ? "d" : "g";
      const amount =
        typeof payload.n === "number" && Number.isFinite(payload.n)
          ? Math.max(1, Math.round(payload.n))
          : 1;

      targetWallet.events.push(newEvent(targetWallet, type, amount));

      const isActiveWallet = targetWallet === wallet;
      // Only arm the dedup guard on the active-wallet path (the boot vs.
      // hashchange race it exists for). Arming it for a non-active/programmatic
      // apply would poison a later real apply of the same code within the window.
      if (isActiveWallet) {
        markGlobalActionHandled(hash);
      }
      if (isActiveWallet && !options.skipPersist) {
        saveWallet(wallet);
        invalidateCaches();
        resetAmount();
        clearExport();
        refreshSummary();
      }

      if (isActiveWallet && !options.skipHashCleanup) {
        const targetUserId =
          typeof options.userId === "string" && options.userId.trim()
            ? options.userId.trim()
            : userId;
        if (targetUserId) replaceHashSilently(targetUserId);
      }

      return { handled: true, applied: true, reason: "applied" };
    }

    let handlingHash = false;
    async function handleHashChange() {
      if (handlingHash) return;
      handlingHash = true;
      try {
        const hash = window.location.hash.slice(1);
        const route = classifyHashValue(hash);
        if (route.kind === "none") {
          if (!wallet) {
            showGlobalActionMessage(
              "Bitte zuerst ein Wallet importieren oder öffnen.",
            );
          }
          return;
        }

        if (route.kind === "globalAction") {
          handleGlobalActionHash(route.raw);
          return;
        }

        if (route.kind === "localAction" || route.kind === "import") {
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

        if (route.kind === "user") {
          await switchToUser(route.userId);
        }
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
      handleWalletStateChange();
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

    window.dbWalletUi = {
      getCurrentUserId: () => userId,
      getCurrentWallet: () => wallet,
      applyGlobalActionHash: (hash, options) =>
        handleGlobalActionHash(hash, options),
      handleWalletStateChange: () => handleWalletStateChange(),
    };

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

    function toggleStatVisibility(el, value) {
      if (!el) return;
      const parent =
        typeof el.closest === "function" ? el.closest(".stat") : el.parentNode;
      if (!parent) return;
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? parseInt(value, 10)
            : 0;
      const n = Number.isFinite(parsed) ? parsed : 0;
      parent.hidden = n === 0;
    }

    function refreshSummary() {
      const summary = getSummary();
      elTotal.textContent = summary.total;
      elUnpaid.textContent = summary.unpaid;
      toggleStatVisibility(elUnpaid, summary.unpaid);
      if (elCredit) {
        elCredit.textContent = summary.credit;
        toggleStatVisibility(elCredit, summary.credit);
      }

      if (syncUi && typeof syncUi.refresh === "function") {
        syncUi.refresh();
      }
      if (historyUi && typeof historyUi.render === "function") {
        historyUi.render();
      }
    }

    function handleWalletStateChange() {
      invalidateCaches();
      clearExport();
      refreshSummary();
    }

    // Stay live across tabs: when another tab of the SAME wallet persists a
    // change, reload from storage and re-render. saveWallet already union-merges
    // on write, so this is purely for UI freshness (the storage event never
    // fires in the tab that wrote it, so there is no feedback loop).
    window.addEventListener("storage", (e) => {
      if (!e || e.key !== helpers.STORAGE_PREFIX + userId) return;
      const reloaded = loadWallet(userId);
      if (reloaded) {
        wallet = reloaded;
        handleWalletStateChange();
      }
    });

    if (btnHome) {
      btnHome.addEventListener("click", () => {
        window.location.href = "index.html";
      });
    }
    if (btnInfo) {
      btnInfo.addEventListener("click", () => {
        window.open("https://github.com/bmmmm/db-wallet", "_blank");
      });
    }

    const actionsApi = window.dbWalletActions || null;
    const actionsCtx = actionsApi
      ? {
          getWallet: () => wallet,
          setWallet: (next) => {
            wallet = next;
          },
          getUserId: () => userId,
          getAmount,
          getSummary,
          getDeleteRange: () =>
            elDeleteRange ? elDeleteRange.value.trim() : "",
          resetAmount,
          resetPayUi,
          clearExport,
          clearDeleteRange: () => {
            if (elDeleteRange) elDeleteRange.value = "";
          },
          setHistoryEmpty: () => {
            if (elHistory) {
              elHistory.textContent = "Noch keine Drinks geloggt. ✨";
            }
          },
          refreshActionCodesUi: () => {
            if (actionCodesUi) actionCodesUi.refresh();
          },
          updateHeaderUi,
          onStateChanged: handleWalletStateChange,
          dialogAlert: (msg) => alert(msg),
          dialogConfirm: (msg) => confirm(msg),
          dialogPrompt: (msg, def) => prompt(msg, def),
        }
      : null;

    btnDrink.addEventListener("click", () => {
      if (actionsApi) actionsApi.bookDrink(actionsCtx);
    });

    btnUndo.addEventListener("click", () => {
      if (actionsApi) actionsApi.undoLast(actionsCtx);
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
        if (actionsApi) actionsApi.payToday(actionsCtx);
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
        if (actionsApi) actionsApi.bookCredit(actionsCtx);
      });
    }

    btnReset.addEventListener("click", () => {
      if (actionsApi) actionsApi.resetWallet(actionsCtx);
    });

    if (btnSelectionDelete) {
      btnSelectionDelete.addEventListener("click", () => {
        if (actionsApi) actionsApi.deleteSelection(actionsCtx);
      });
    }

    if (btnEditEntry) {
      btnEditEntry.addEventListener("click", () => {
        if (actionsApi) actionsApi.editEntry(actionsCtx);
      });
    }
  });
})();
