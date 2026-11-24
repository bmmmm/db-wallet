(function () {
  // theme.js loads synchronously in <head>, before every deferred script.
  const themeApi = window.dbWalletTheme || null;
  if (!themeApi) return;
  const { canonicalThemeName, getStoredTheme, initThemeSelector } = themeApi;

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
    const ok = themeApi.applyTheme(name);
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

  const { base64UrlEncodeBytes, gzipCompress } = helpers;

  const {
    ensureNonReservedUserId,
    getDeviceKey,
    getLocalDeviceSymbol,
    setLocalDeviceSymbol,
    touchLocalDevice,
    ensureDeviceSeq,
    newEvent,
    appendEvents,
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

  // Shared with the codec (wallet-helpers.js): history.replaceState, no
  // hashchange, no new history entry.
  function replaceHashSilently(nextHash) {
    const target = String(nextHash || "").trim();
    if (!target) return false;
    return helpers.replaceHashSilently(target);
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
    const exportUrlActions = document.getElementById("export-url-actions");
    const actionCodesPanel = document.getElementById("action-codes-panel");
    const actionCodesBody = document.getElementById("action-codes-body");
    const elHistory = document.getElementById("history");
    const elHistoryList = document.getElementById("history-list");
    const logTools = document.getElementById("log-tools");
    const logEditGroup = document.getElementById("log-edit-group");
    const logEditToggle = document.getElementById("log-edit-toggle");

    const btnMigrate = document.getElementById("btn-migrate");
    const btnDrink = document.getElementById("btn-drink");
    const btnUndo = document.getElementById("btn-undo");
    const btnPay = document.getElementById("btn-pay");
    const payOptions = document.getElementById("pay-options");
    const btnPayToday = document.getElementById("btn-pay-today");
    const btnCredit = document.getElementById("btn-credit");
    const creditForm = document.getElementById("credit-form");
    const creditAmount = document.getElementById("credit-amount");
    const btnCreditCancel = document.getElementById("btn-credit-cancel");
    // The credit form's default amount (wallet.html value="10").
    const CREDIT_DEFAULT = "10";
    const btnPayCancel = document.getElementById("btn-pay-cancel");
    const btnExport = document.getElementById("btn-export");
    const exportOptions = document.getElementById("export-options");
    const btnExportLinkQr = document.getElementById("btn-export-link-qr");
    const btnExportJson = document.getElementById("btn-export-json");
    const btnReset = document.getElementById("btn-reset");
    const btnModeDiagram = document.getElementById("mode-diagram");
    const btnModeLog = document.getElementById("mode-log");
    const btnModeRaw = document.getElementById("mode-raw");

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
      // The export flow and history-mode toggles dereference these without their
      // own null guards, so fail-fast on a broken DOM instead of throwing later.
      elExportUrl,
      btnModeDiagram,
      btnModeLog,
      btnModeRaw,
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

    // No wallet open: show the way out (start page + wallet list) and react to
    // a hash set afterwards (a list link, a pasted link, the address bar). The
    // full hashchange router below is never registered on this path — the UI
    // isn't wired — so a new non-empty hash reloads into the normal boot.
    let noWalletHashListener = null;
    function enterNoWalletState(message) {
      const wallets = getAllWallets ? getAllWallets() : {};
      const userIds = Object.keys(wallets).sort((a, b) => a.localeCompare(b));
      if (hashActions && typeof hashActions.showNoWalletState === "function") {
        hashActions.showNoWalletState({ message, userIds });
      } else {
        setNoWalletState();
        showGlobalActionMessage(message);
      }
      if (!noWalletHashListener) {
        noWalletHashListener = () => {
          if (!window.location.hash.slice(1)) return;
          window.location.reload();
        };
        window.addEventListener("hashchange", noWalletHashListener);
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
        enterNoWalletState(
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
            enterNoWalletState(
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
      enterNoWalletState(
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

    const deviceUi = window.dbWalletDeviceUI || null;
    const syncUi = window.dbWalletSyncUI || null;
    const exportUi = window.dbWalletExportUI || null;
    const historyUi = window.dbWalletHistoryUI || null;

    let userId = initialUserId || (await resolveInitialUserId());
    if (redirectedToPreview) return;
    if (!userId) {
      // E.g. a broken import link or a declined action code on a cold start:
      // the error was reported; don't leave the unwired wallet UI showing.
      enterNoWalletState("Bitte zuerst ein Wallet importieren oder öffnen.");
      return;
    }
    let wallet = initialWallet || loadWallet(userId);
    if (!wallet) {
      enterNoWalletState(
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
      const codesUiApi = window.dbWalletActionCodesUI || null;
      if (codesUiApi && typeof codesUiApi.initActionCodesUi === "function") {
        actionCodesUi = codesUiApi.initActionCodesUi({
          container: actionCodesBody,
          panel: actionCodesPanel,
          getWallet: () => wallet,
          // The panel hands over a changed copy (action-codes.js pure
          // functions); adopt it only when it was saved, so a refused save
          // leaves the shown wallet matching the stored one.
          persistWallet: (next) => {
            if (saveWallet(next)) wallet = next;
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
          btnExportLinkQr,
          btnExportJson,
          elExportUrl,
          qrBox,
          qrHint,
          qrCanvas,
          qrUrl,
          exportUrlActions,
          btnCopyExportUrl: document.getElementById("btn-copy-export-url"),
          btnShareExportUrl: document.getElementById("btn-share-export-url"),
          exportUrlStatus: document.getElementById("export-url-status"),
          btnCopyQrUrl: document.getElementById("btn-copy-qr-url"),
          btnShareQrUrl: document.getElementById("btn-share-qr-url"),
          qrUrlStatus: document.getElementById("qr-url-status"),
        },
        getWallet: () => wallet,
        saveWallet: (w) => saveWallet(w),
        encodeImportV2Bytes,
        gzipCompress,
        base64UrlEncodeBytes,
        todayDateStr,
        needsMigration,
        runMigrationDialog,
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
        getWallet: () => wallet,
        saveWallet: (w) => saveWallet(w),
        getLocalSymbol: () =>
          (typeof getLocalDeviceSymbol === "function"
            ? getLocalDeviceSymbol(wallet)
            : "") || "_",
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
          elHistoryList,
          logTools,
          logEditGroup,
          logEditToggle,
          btnModeDiagram,
          btnModeLog,
          btnModeRaw,
        },
        getWallet: () => wallet,
        getSummary,
        // P4.4: the row actions; actionsCtx is set up further down, before
        // any click can reach these.
        onEditEntry: (root, values) =>
          actionsApi ? actionsApi.editEntry(actionsCtx, root, values) : false,
        onDeleteEntry: (root) =>
          actionsApi ? actionsApi.deleteEntry(actionsCtx, root) : false,
        limits: window.dbWalletActions ? window.dbWalletActions.LIMITS : undefined,
        onAfterRender: () => {
          if (syncUi && typeof syncUi.refresh === "function") {
            syncUi.refresh();
          }
        },
      });
    }

    updateUidLabel();
    elExportUrl.value = ""; // initially empty

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
      return storage.walletBackupData(wallet, theme);
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

      const { type, amount, label: payloadLabel } =
        actionApi.globalPayloadAction(payload);

      // Confirm before applying: a global ('acg:') QR books onto the wallet with
      // no key/auth check, so make the inflation explicit instead of silently
      // pushing it (on every path — boot, hashchange, and after wallet select).
      if (!options.skipConfirm && typeof confirm === "function") {
        const label = payloadLabel ? ` „${payloadLabel}“` : "";
        const what =
          type === "d"
            ? `${amount} Getränk(e) trinken`
            : `Guthaben +${amount} Getränk(e)`;
        if (!confirm(`Globalen Action-Code${label} anwenden: ${what}?`)) {
          // Strip the acg hash from the URL so a reload doesn't re-prompt the
          // declined code. Do NOT arm the dedup guard — a decline isn't a
          // consume, so a deliberate later re-apply of the same code must still
          // be allowed.
          if (targetWallet === wallet && !options.skipHashCleanup) {
            replaceHashSilently(userId);
          }
          return { handled: true, applied: false, reason: "declined" };
        }
      }

      const event = newEvent(targetWallet, type, amount);

      const isActiveWallet = targetWallet === wallet;
      // Only arm the dedup guard on the active-wallet path (the boot vs.
      // hashchange race it exists for). Arming it for a non-active/programmatic
      // apply would poison a later real apply of the same code within the window.
      if (isActiveWallet) {
        markGlobalActionHandled(hash);
      }
      if (isActiveWallet && !options.skipPersist) {
        // appendEvents snapshots + pushes + persists + rolls back atomically, so
        // a failed write leaves the balance untouched instead of rolling back
        // silently. Surface the failure — wording mirrors wallet-actions.js's
        // persistMutation alert — instead of pretending the booking happened.
        if (!appendEvents(wallet, [event])) {
          if (storage.getLastSaveError() === "replaced") {
            storage.notifyWalletReplaced();
          } else {
            helpers.notify(
              "Speichern fehlgeschlagen — Aktion verworfen (Speicher voll oder blockiert).",
              { kind: "error" },
            );
          }
          return { handled: true, applied: false, reason: "save-failed" };
        }
        invalidateCaches();
        resetAmount();
        clearExport();
        refreshSummary();
        const summary = getSummary();
        const balance =
          summary.credit > 0 ? `Guthaben: ${summary.credit}` : `Offen: ${summary.unpaid}`;
        const what = type === "d" ? `+${amount} gebucht` : `Guthaben +${amount} gebucht`;
        helpers.notify(`${payloadLabel ? `„${payloadLabel}“: ` : ""}${what} · ${balance}`);
      } else {
        // Non-persisting path: the boot pre-apply (skipPersist — the caller
        // saves later) or a non-active/programmatic wallet. Stage the append in
        // memory only.
        targetWallet.events.push(event);
      }

      if (isActiveWallet && !options.skipHashCleanup) {
        replaceHashSilently(userId);
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
        if (route.kind === "none") return;

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
          replaceHashSilently(userId);
        }
      } finally {
        handlingHash = false;
      }
    }
    // Returns the handler's promise: the browser ignores it, the Node test
    // harness awaits it (tests/wallet-page.js flushHashChanges).
    window.addEventListener("hashchange", () => handleHashChange());

    function downloadCurrentWalletBackup(tag) {
      helpers.downloadJson(
        exportJsonData(),
        storage.walletBackupFileName(wallet.userId, todayDateStr(), tag),
      );
    }

    function migrateWalletNow() {
      if (typeof window.dbWalletMigrateV1toV2 !== "function") {
        helpers.notify("Migration ist nicht verfügbar (migration.js fehlt).", {
          kind: "error",
        });
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
      applyGlobalActionHash: (hash, options) =>
        handleGlobalActionHash(hash, options),
      handleWalletStateChange: () => handleWalletStateChange(),
    };

    function getAmount() {
      const n = parseInt(elAmount.value, 10);
      if (isNaN(n) || n <= 0) return 1;
      return Math.min(n, helpers.MAX_EVENT_AMOUNT);
    }

    // Moves the keyboard focus without letting a missing element throw.
    function focusEl(el) {
      if (!el || typeof el.focus !== "function") return;
      try {
        el.focus();
      } catch (e) {
        // ignore
      }
    }

    // P4.6: the pay button settles every open drink, so it says how many;
    // nothing open, nothing to pay.
    function updatePayButton(unpaid) {
      if (!btnPayToday) return;
      const n = Number.isFinite(unpaid) ? unpaid : 0;
      btnPayToday.textContent = `Alle ${n} offenen bezahlen 💰`;
      btnPayToday.disabled = n <= 0;
    }

    function payOptionsOpen() {
      return !!payOptions && payOptions.style.display === "flex";
    }

    // P4.3: the credit form under the pay options (hidden by style.css, so
    // an inline "" counts as closed).
    function creditFormOpen() {
      return !!creditForm && creditForm.style.display === "flex";
    }

    function setCreditForm(open) {
      if (!creditForm) return;
      creditForm.style.display = open ? "flex" : "none";
      if (btnCredit) btnCredit.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open && creditAmount) creditAmount.value = CREDIT_DEFAULT;
    }

    // Resets the payment UI centrally; when the options were open the focus
    // returns to "Bezahlen" (the options it was on disappear).
    function resetPayUi() {
      const wasOpen = payOptionsOpen();
      setCreditForm(false);
      if (payOptions) {
        payOptions.style.display = "none";
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
      if (wasOpen) focusEl(btnPay);
    }

    function refreshSummary() {
      const summary = getSummary();
      elTotal.textContent = summary.total;
      elUnpaid.textContent = summary.unpaid;
      updatePayButton(summary.unpaid);
      // P4.2: all three stats always show (a card hiding at 0 made the
      // booking buttons jump after the first booking).
      if (elCredit) elCredit.textContent = summary.credit;

      // syncUi.refresh() runs via historyUi.render()'s onAfterRender callback
      // (see historyUi.init), which also fires on the mode toggles that
      // re-render without going through refreshSummary — so the sync line is
      // refreshed on exactly one path. Do NOT add a direct syncUi.refresh() here
      // when historyUi is present: that would rebuild the ASCII timeline + device
      // legend twice per mutation.
      if (historyUi && typeof historyUi.render === "function") {
        historyUi.render();
      } else if (syncUi && typeof syncUi.refresh === "function") {
        // No historyUi → no onAfterRender, so refresh the sync line directly.
        syncUi.refresh();
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
          resetAmount,
          resetPayUi,
          clearExport,
          refreshActionCodesUi: () => {
            if (actionCodesUi) actionCodesUi.refresh();
          },
          updateHeaderUi,
          onStateChanged: handleWalletStateChange,
          // Errors and notices go to the status line (P4.1), questions to
          // the shared dialog (P4.3; a Promise of the answer).
          dialogAlert: (msg) => helpers.notify(msg, { kind: "error" }),
          notify: (msg, opts) => helpers.notify(msg, opts),
          dialogConfirm: (msg, opts) => helpers.confirmDialog(msg, opts),
        }
      : null;

    btnDrink.addEventListener("click", () => {
      if (actionsApi) actionsApi.bookDrink(actionsCtx);
    });

    // Enter in the amount field books, like "+ Trinken" (not while the pay
    // options replace the booking buttons).
    elAmount.addEventListener("keydown", (e) => {
      if (!e || e.key !== "Enter") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (payOptionsOpen()) return;
      if (actionsApi) actionsApi.bookDrink(actionsCtx);
    });

    btnUndo.addEventListener("click", () => {
      if (actionsApi) actionsApi.undoLast(actionsCtx);
    });

    btnPay.addEventListener("click", () => {
      if (!payOptions) return;
      // Toggle visibility of the payment options
      if (
        payOptions.style.display === "none" ||
        payOptions.style.display === ""
      ) {
        payOptions.style.display = "flex";
        // During the payment flow, hide the pay, undo and drink buttons
        if (btnPay) btnPay.style.display = "none";
        if (btnUndo) btnUndo.style.display = "none";
        if (btnDrink) btnDrink.style.display = "none";
        // The focus was on "Bezahlen", which just disappeared (P4.9).
        focusEl(btnPayToday && !btnPayToday.disabled ? btnPayToday : btnCredit);
      } else {
        // Cancel/collapse the payment flow -> reset the UI
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

    if (btnCredit && creditForm) {
      btnCredit.addEventListener("click", () => {
        if (creditFormOpen()) {
          setCreditForm(false);
          return;
        }
        setCreditForm(true);
        focusEl(creditAmount);
        if (creditAmount && typeof creditAmount.select === "function") creditAmount.select();
      });
      creditForm.addEventListener("submit", (e) => {
        // CSP form-action 'none': never a real submit.
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        if (!actionsApi || !creditAmount) return;
        // On success bookCredit closes the pay UI (resetPayUi); on an error
        // the form stays open with the message in the status line.
        if (!actionsApi.bookCredit(actionsCtx, creditAmount.value)) focusEl(creditAmount);
      });
      const closeCreditForm = () => {
        setCreditForm(false);
        focusEl(btnCredit);
      };
      if (btnCreditCancel) btnCreditCancel.addEventListener("click", closeCreditForm);
      creditForm.addEventListener("keydown", (e) => {
        if (!e || e.key !== "Escape") return;
        if (typeof e.preventDefault === "function") e.preventDefault();
        closeCreditForm();
      });
    }

    btnReset.addEventListener("click", () => {
      if (actionsApi) actionsApi.resetWallet(actionsCtx);
    });
  });
})();
