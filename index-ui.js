(function () {
  const helpers = window.dbWalletHelpers || null;
  const storage = window.dbWalletStorage || null;
  const summaryApi = window.dbWalletSummary || null;
  const importV2 = window.dbWalletImportV2 || null;
  const themeApi = window.dbWalletTheme || null;
  const importPreview = window.dbWalletImportPreview || null;
  const hashRouter = window.dbWalletHashRouter || null;

  if (!helpers || !storage || !summaryApi || !importV2) {
    return;
  }

  const {
    STORAGE_PREFIX,
    REGISTRY_KEY,
    safeParse,
    safeLocalStorageRemoveItem,
    loadRegistry,
    saveRegistry,
    formatDateTime,
    normalizeUserId,
  } = helpers;

  const {
    isReservedStorageKey,
    ensureNonReservedUserId,
    userIdExists,
    findUserIdByWalletId,
    getAllWallets,
    ensureDeviceSeq,
    saveWallet,
  } = storage;

  const { computeSummary, todayDateStr } = summaryApi;

  const { buildImportedWallet, applyImportedTheme } = importV2;

  function formatDateTimeDisplay(ts) {
    const out = formatDateTime(ts);
    return out || "—";
  }

  function clearRawOutput() {
    const rawOutput = document.getElementById("raw-output");
    if (!rawOutput) return;
    rawOutput.textContent = "";
    rawOutput.hidden = true;
  }

  function showGlobalActionMessage(message) {
    const api = window.dbWalletMessages;
    if (!api || typeof api.showGlobal !== "function") return null;
    return api.showGlobal(message, {
      className: "action-codes-notice card card--flat",
      anchors: ["#index-header", "h1"],
    });
  }

  function focusEl(el) {
    if (el && typeof el.focus === "function") {
      try {
        el.focus();
      } catch (e) {
        // ignore
      }
    }
  }

  function getThemeForBackup() {
    const api = window.dbWalletTheme || null;
    return api && typeof api.getStoredTheme === "function" ? api.getStoredTheme() : null;
  }

  // P4.5: the JSON backup offered before a delete — the same file as
  // wallet.html's "Als JSON herunterladen"; "JSON importieren" reads it back.
  function downloadBackup(userId) {
    const wallet = getAllWallets()[userId];
    if (!wallet) return false;
    return !!helpers.downloadJson(
      storage.walletBackupData(wallet, getThemeForBackup()),
      storage.walletBackupFileName(userId, todayDateStr(), "backup"),
    );
  }

  function backupExtra(userIds) {
    const n = userIds.length;
    return {
      label: n > 1 ? `Vorher ${n} Backups herunterladen 📄` : "Vorher Backup herunterladen 📄",
      run: () => {
        const saved = userIds.filter((id) => downloadBackup(id)).length;
        if (saved === n) return n > 1 ? `${n} Backups heruntergeladen ✓` : "Backup heruntergeladen ✓";
        return "Backup fehlgeschlagen – nochmal versuchen";
      },
    };
  }

  // Only db-wallet's own keys: the origin is shared with the account's other
  // Pages apps, so a bare `userId` key belongs to one of them.
  function removeUserData(userId) {
    safeLocalStorageRemoveItem(STORAGE_PREFIX + userId);
    const nextReg = loadRegistry();
    if (nextReg && typeof nextReg === "object" && nextReg[userId]) {
      delete nextReg[userId];
      saveRegistry(nextReg);
    }
  }

  // The entries the history shows (deleted and replaced ones don't count).
  function visibleEntryCount(wallet) {
    try {
      return summaryApi.applyTombstones(wallet && wallet.events).effectiveEvents.length;
    } catch (e) {
      return Array.isArray(wallet && wallet.events) ? wallet.events.length : 0;
    }
  }

  function describeLoss(count) {
    if (count === 0) return "Es enthält noch keine Einträge. ";
    const what = count === 1 ? "Der eine Eintrag geht" : `Alle ${count} Einträge gehen`;
    return `${what} hier verloren; andere Geräte behalten ihre Kopie. `;
  }

  async function deleteUser(userId) {
    const wallet = getAllWallets()[userId];
    if (!wallet) {
      renderExistingUsers();
      return;
    }
    const ok = await helpers.confirmDialog(
      `Wallet „${userId}“ auf diesem Gerät löschen?\n\n` +
        describeLoss(visibleEntryCount(wallet)) +
        "Ein Backup lässt sich später über „JSON importieren“ zurückholen.",
      { okLabel: "Löschen", danger: true, extra: backupExtra([userId]) },
    );
    if (!ok) return;

    // The list position, so the focus can land on the neighbour afterwards.
    const ids = sortedUserIds();
    const at = ids.indexOf(userId);
    removeUserData(userId);
    clearRawOutput();
    renderExistingUsers();
    helpers.notify(`Wallet „${userId}“ gelöscht.`);

    const rest = sortedUserIds();
    const next = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : "";
    const container = document.getElementById("existing-users");
    const target = next && container ? findOpenButton(container, next) : null;
    focusEl(target || document.getElementById("username"));
  }

  function findOpenButton(container, userId) {
    const buttons = container.querySelectorAll ? container.querySelectorAll("button") : [];
    for (const b of buttons) {
      if (b.dataset && b.dataset.openUser === userId) return b;
    }
    return null;
  }

  function sortedUserIds() {
    return Object.keys(getAllWallets()).sort((a, b) => a.localeCompare(b));
  }

  function openUser(userId) {
    window.location.href = "wallet.html#" + userId;
  }

  // P4.5: the wallets on this device, above the "open or create" field.
  // "Öffnen" and "Löschen" sit apart, "Löschen" in --danger.
  function renderExistingUsers() {
    const container = document.getElementById("existing-users");
    const section = document.getElementById("existing-users-section");
    if (!container) return;

    const reg = loadRegistry();
    const wallets = getAllWallets();
    const userIds = Object.keys(wallets).sort((a, b) => a.localeCompare(b));

    container.innerHTML = "";
    if (section) section.hidden = !userIds.length;
    if (!userIds.length) return;

    // Per-wallet summaries (computeSummary walks the full event log) are filled
    // in after first paint so the user list appears immediately instead of
    // blocking on every wallet's history.
    const pendingSummaries = [];

    for (const userId of userIds) {
      const wallet = wallets[userId];

      const card = document.createElement("li");
      card.className = "wallet-card card card--flat";

      const name = document.createElement("strong");
      name.className = "wallet-card-name";
      name.textContent = userId;

      const entry =
        reg && typeof reg === "object" && reg[userId] ? reg[userId] : null;
      const lastUpdated =
        entry &&
        typeof entry.lastUpdated === "number" &&
        Number.isFinite(entry.lastUpdated)
          ? entry.lastUpdated
          : 0;

      const meta = document.createElement("div");
      meta.className = "wallet-card-meta";
      meta.textContent = "Letztes Update: " + formatDateTimeDisplay(lastUpdated);

      const summaryLine = document.createElement("div");
      summaryLine.className = "wallet-card-summary";
      summaryLine.textContent = "Lädt …";
      pendingSummaries.push({ summaryLine, wallet });

      const actions = document.createElement("div");
      actions.className = "wallet-card-actions";

      const btnOpen = document.createElement("button");
      btnOpen.type = "button";
      btnOpen.className = "wallet-open";
      btnOpen.textContent = "Öffnen";
      btnOpen.dataset.openUser = userId;
      btnOpen.setAttribute("aria-label", `Wallet „${userId}“ öffnen`);
      btnOpen.addEventListener("click", () => openUser(userId));

      const btnDelete = document.createElement("button");
      btnDelete.type = "button";
      btnDelete.className = "wallet-delete btn-danger";
      btnDelete.textContent = "Löschen";
      btnDelete.setAttribute("aria-label", `Wallet „${userId}“ löschen`);
      btnDelete.addEventListener("click", () => deleteUser(userId));

      actions.appendChild(btnOpen);
      actions.appendChild(btnDelete);

      card.appendChild(name);
      card.appendChild(meta);
      card.appendChild(summaryLine);
      card.appendChild(actions);

      container.appendChild(card);
    }

    // Plain macrotask, not requestAnimationFrame: rAF never fires in hidden
    // tabs, which would leave the placeholders unfilled until the tab gains
    // focus. A setTimeout(0) is enough to get the list painted first.
    setTimeout(() => {
      for (const { summaryLine, wallet } of pendingSummaries) {
        let summary = { total: 0, unpaid: 0, credit: 0 };
        try {
          summary = computeSummary(wallet);
        } catch (e) {
          // ignore
        }
        summaryLine.textContent = `Getrunken: ${summary.total} · Offen: ${summary.unpaid} · Guthaben: ${summary.credit}`;
      }
    }, 0);
  }

  async function tryParseWalletIdFromHash(hash) {
    const raw = String(hash || "");
    if (!raw) return "";

    if (hashRouter && typeof hashRouter.parseWalletIdFromHash === "function") {
      try {
        return await hashRouter.parseWalletIdFromHash(raw);
      } catch (e) {
        return "";
      }
    }

    return "";
  }

  function classifyHashValue(raw) {
    if (hashRouter && typeof hashRouter.classifyHash === "function") {
      return hashRouter.classifyHash(raw);
    }
    return { kind: "none" };
  }

  async function handleHashRouting() {
    const hash = window.location.hash.slice(1);
    const route = classifyHashValue(hash);
    if (route.kind === "none" || route.kind === "user") {
      return false;
    }
    if (route.kind === "globalAction") {
      showGlobalActionMessage(
        "Bitte zuerst ein Wallet importieren oder öffnen.",
      );
      return false;
    }
    if (route.kind !== "import" && route.kind !== "localAction") return false;

    let walletId = "";
    try {
      walletId = await tryParseWalletIdFromHash(route.raw);
    } catch (e) {
      walletId = "";
    }

    const kind = route.kind === "localAction" ? "Action Code" : "Import";
    const knownUserId = walletId ? findUserIdByWalletId(walletId) : null;

    let msg = `${kind} Link erkannt.\n\nIn wallet.html öffnen?`;
    if (knownUserId) {
      msg = `${kind} Link erkannt.\n\nLokales Profil: "${knownUserId}".\n\nIn wallet.html öffnen?`;
    } else if (walletId) {
      msg = `${kind} Link erkannt.\n\nDieses Wallet ist lokal nicht bekannt.\n\nIn wallet.html öffnen?`;
    }

    if (!(await helpers.confirmDialog(msg, { okLabel: "Öffnen" }))) {
      // Decision I1: drop the declined link. Replace it in place — assigning
      // location.hash would leave the #i2:/#ac: entry in the session history.
      if (
        !(typeof helpers.replaceHashSilently === "function" && helpers.replaceHashSilently(""))
      ) {
        window.location.hash = "";
      }
      return false;
    }

    window.location.href = "wallet.html" + window.location.hash;
    return true;
  }

  // P4.5: what "Weiter" does with the typed name. An existing name opens that
  // wallet (it used to create "peter-2" without a word); umlauts are spelled
  // out ("Jörg" → "joerg"); an empty or unusable name gets a random one.
  function resolveStartTarget(raw) {
    const typed = String(raw || "").trim();
    const normalized = normalizeUserId(typed);
    if (!normalized) {
      return { userId: "", exists: false, random: true, unusable: !!typed };
    }
    const userId = ensureNonReservedUserId(normalized);
    return { userId, exists: userIdExists(userId), random: false, unusable: false };
  }

  function describeStartTarget(target, typed) {
    if (!String(typed || "").trim()) return "";
    if (target.unusable) {
      return "Kein verwendbares Zeichen – „Weiter“ legt ein Wallet mit zufälligem Namen an.";
    }
    if (target.exists) return `Öffnet das vorhandene Wallet „${target.userId}“.`;
    return `Legt das neue Wallet „${target.userId}“ an.`;
  }

  function updateStartHint() {
    const input = document.getElementById("username");
    const hint = document.getElementById("username-hint");
    if (!input || !hint) return;
    hint.textContent = describeStartTarget(resolveStartTarget(input.value), input.value);
  }

  function startNewUser() {
    const input = document.getElementById("username");
    const target = resolveStartTarget(input ? input.value : "");
    const userId = target.random ? ensureNonReservedUserId("") : target.userId;
    openUser(userId);
  }

  // P4.8: a pasted link from another device (the installed app has its own
  // storage, so a scanned QR may have opened the browser instead). Only the
  // part after "#" counts — the host may differ — and wallet.html's router
  // takes it from there, like an opened link.
  function hashFromPastedLink(text) {
    const s = String(text || "").replace(/\s+/g, "");
    if (!s) return "";
    let i = s.indexOf("#");
    let skip = 1;
    if (i < 0) {
      // Some apps hand the link on with the "#" percent-encoded.
      i = s.toLowerCase().indexOf("%23");
      skip = 3;
    }
    return i >= 0 ? s.slice(i + skip) : s;
  }

  function openPastedLink(text) {
    const hash = hashFromPastedLink(text);
    if (!hash) {
      return { ok: false, message: "Bitte zuerst einen Link einfügen." };
    }
    const route = classifyHashValue(hash);
    if (route.kind === "import" || route.kind === "localAction" || route.kind === "globalAction") {
      window.location.href = "wallet.html#" + hash;
      return { ok: true };
    }
    if (route.kind === "user") {
      if (userIdExists(route.userId)) {
        openUser(route.userId);
        return { ok: true };
      }
      return {
        ok: false,
        message:
          `Der Link nennt nur den Namen „${route.userId}“, die Daten stehen nicht darin. ` +
          "Auf dem anderen Gerät unter „Export“ einen Link oder QR-Code erzeugen und den einfügen.",
      };
    }
    return {
      ok: false,
      message:
        "Kein db-wallet-Link erkannt. Ein Export-Link enthält „#i2:“ oder „#import:“, ein Action Code „#ac:“ oder „#acg:“.",
    };
  }

  function importJsonFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev && ev.target ? ev.target.result : "";
        const remote = safeParse(text);
        if (!remote || typeof remote !== "object") {
          throw new Error("Ungültiges JSON-Format.");
        }

        // Built once for the dialog header, and again after the dialog: the
        // stored state may change while it is open (another tab books or
        // resets this wallet), and a wallet built before would then merge
        // stale data or hit the P1.9 save lock.
        const build = () => {
          const built = buildImportedWallet(remote);
          const id = built && typeof built.userId === "string" ? built.userId : "";
          if (!id || !built.wallet) {
            throw new Error("Ungültiges JSON-Format.");
          }
          return built;
        };
        let built = build();
        let userId = built.userId;

        const importedTheme =
          remote && typeof remote.theme === "string" ? remote.theme : "";

        const chooseMode =
          importPreview && typeof importPreview.chooseImportMode === "function"
            ? importPreview.chooseImportMode
            : null;
        const openPreview =
          importPreview && typeof importPreview.openPreview === "function"
            ? importPreview.openPreview
            : null;

        let mode = "persist";
        if (chooseMode) {
          mode = await chooseMode({
            header: `Import für "${userId}"`,
          });
          if (!mode) return;
        }

        if (chooseMode) {
          built = build();
          userId = built.userId;
        }
        const wallet = built.wallet;

        if (mode === "preview" && openPreview) {
          openPreview({
            source: "json",
            wallet,
            theme: importedTheme,
          });
          return;
        }

        ensureDeviceSeq(wallet);
        if (!saveWallet(wallet, { quiet: true })) {
          const importApi = window.dbWalletImportV2 || null;
          helpers.notify(
            importApi && typeof importApi.importSaveFailedMessage === "function"
              ? importApi.importSaveFailedMessage()
              : "Import fehlgeschlagen: Die Daten konnten nicht gespeichert werden.",
            { kind: "error" },
          );
          return;
        }
        applyImportedTheme(remote);

        renderExistingUsers();
        window.location.href = "wallet.html#" + userId;
      } catch (err) {
        helpers.notify(
          "Import fehlgeschlagen: " + (err && err.message ? err.message : err),
          { kind: "error" },
        );
      }
    };
    reader.readAsText(file);
  }

  function showRawAll() {
    const rawOutput = document.getElementById("raw-output");
    if (!rawOutput) return;
    rawOutput.hidden = false;

    const wallets = getAllWallets();
    const userIds = Object.keys(wallets).sort((a, b) => a.localeCompare(b));

    if (!userIds.length) {
      rawOutput.textContent =
        "Keine Wallet-Daten im lokalen Speicher gefunden.";
      return;
    }

    const all = userIds.map((userId) => ({
      storageKey: STORAGE_PREFIX + userId,
      userId,
      wallet: wallets[userId],
    }));
    rawOutput.textContent = JSON.stringify(all, null, 2);
  }

  async function nukeAll() {
    const collectKeys = () => {
      let len = 0;
      try {
        len =
          typeof localStorage !== "undefined" && localStorage
            ? localStorage.length
            : 0;
      } catch (e) {
        len = 0;
      }
      const keys = [];
      for (let i = 0; i < len; i++) {
        let key = null;
        try {
          key = localStorage.key(i);
        } catch (e) {
          continue;
        }
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        if (isReservedStorageKey(key)) continue;
        keys.push(key);
      }
      return keys;
    };

    const keysToDelete = collectKeys();
    if (!keysToDelete.length) {
      helpers.notify("Es wurden keine lokalen Nutzer:innen gefunden.");
      return;
    }

    const userIds = keysToDelete
      .map((k) => k.slice(STORAGE_PREFIX.length))
      .sort((a, b) => a.localeCompare(b));
    const walletIds = userIds.filter((id) => !!getAllWallets()[id]);

    const confirmMsg =
      (userIds.length === 1
        ? `Die lokale Nutzer:in „${userIds[0]}“ vollständig löschen?`
        : `Alle ${userIds.length} lokalen Nutzer:innen vollständig löschen?\n\n` +
          userIds.join(", ")) +
      "\n\nDas lässt sich nicht rückgängig machen; andere Geräte behalten ihre Kopie.";

    const ok = await helpers.confirmDialog(confirmMsg, {
      okLabel: userIds.length === 1 ? "Löschen" : `Alle ${userIds.length} löschen`,
      danger: true,
      extra: walletIds.length ? backupExtra(walletIds) : undefined,
    });
    if (!ok) return;

    // Re-read: another tab may have added or removed a wallet meanwhile.
    collectKeys().forEach((key) => safeLocalStorageRemoveItem(key));

    safeLocalStorageRemoveItem(REGISTRY_KEY);

    clearRawOutput();
    renderExistingUsers();
    helpers.notify("Alle lokalen db-wallet-Nutzer:innen wurden gelöscht.");
    focusEl(document.getElementById("username"));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const inputUsername = document.getElementById("username");
    const btnStart = document.getElementById("btn-start");
    const btnSearchUsers = document.getElementById("btn-search-users");
    const btnImportJson = document.getElementById("btn-import-json");
    const fileImport = document.getElementById("file-import");
    const btnRawAll = document.getElementById("btn-raw-all");
    const btnNukeAll = document.getElementById("btn-nuke-all");
    const pasteForm = document.getElementById("paste-link-form");
    const pasteInput = document.getElementById("paste-link");
    const rawOutput = document.getElementById("raw-output");

    if (rawOutput && !rawOutput.textContent) rawOutput.hidden = true;

    if (btnSearchUsers) {
      btnSearchUsers.addEventListener("click", () => renderExistingUsers());
    }

    if (btnStart) {
      btnStart.addEventListener("click", () => startNewUser());
    }
    if (inputUsername) {
      inputUsername.addEventListener("keydown", (e) => {
        if (e && e.key === "Enter") startNewUser();
      });
      inputUsername.addEventListener("input", () => updateStartHint());
    }

    if (pasteForm && pasteInput) {
      pasteInput.addEventListener("input", () => pasteInput.removeAttribute("aria-invalid"));
      pasteForm.addEventListener("submit", (e) => {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        const res = openPastedLink(pasteInput.value);
        if (res.ok) return;
        pasteInput.setAttribute("aria-invalid", "true");
        // Focus first: the notice scrolls the focused field clear of itself.
        focusEl(pasteInput);
        helpers.notify(res.message, { kind: "error" });
      });
    }

    if (btnRawAll) {
      btnRawAll.addEventListener("click", () => showRawAll());
    }

    if (btnNukeAll) {
      btnNukeAll.addEventListener("click", () => nukeAll());
    }

    if (btnImportJson && fileImport) {
      btnImportJson.addEventListener("click", () => {
        fileImport.value = "";
        fileImport.click();
      });

      fileImport.addEventListener("change", (e) => {
        const file = e && e.target && e.target.files ? e.target.files[0] : null;
        if (!file) return;
        importJsonFile(file);
      });
    }

    if (themeApi && typeof themeApi.initThemeSelector === "function") {
      themeApi.initThemeSelector();
    }

    // The list first, so it shows behind a link's "open?" question.
    renderExistingUsers();
    updateStartHint();
    await handleHashRouting();
  });

  // For tests (Node harness): the pure parts of the start page.
  window.dbWalletIndexUI = {
    resolveStartTarget,
    describeStartTarget,
    hashFromPastedLink,
    openPastedLink,
  };
})();
