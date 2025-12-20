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
    base64UrlDecode,
    base64UrlDecodeBytes,
    gzipDecompress,
    safeParse,
    safeLocalStorageRemoveItem,
    loadRegistry,
    saveRegistry,
  } = helpers;

  const {
    isReservedStorageKey,
    ensureNonReservedUserId,
    userIdExists,
    makeUniqueUserId,
    findUserIdByWalletId,
    getAllWallets,
    ensureDeviceSeq,
    saveWallet,
  } = storage;

  const { computeSummary } = summaryApi;

  const { decodeImportV2Bytes, buildImportedWallet, applyImportedTheme } =
    importV2;

  function formatDateTime(ts) {
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
      return "—";
    }
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function normalizeUserName(input) {
    let n = String(input || "")
      .trim()
      .toLowerCase();
    n = n.replace(/\s+/g, "-");
    n = n.replace(/[^a-z0-9_-]/g, "");
    return n;
  }

  function clearRawOutput() {
    const rawOutput = document.getElementById("raw-output");
    if (rawOutput) rawOutput.textContent = "";
  }

  function showGlobalActionMessage(message) {
    const text = String(message || "").trim();
    if (!text) return;
    let el = document.getElementById("global-action-message");
    if (!el) {
      el = document.createElement("div");
      el.id = "global-action-message";
      el.className = "action-codes-notice";
      const title = document.querySelector("h1");
      if (title && title.parentNode) {
        title.parentNode.insertBefore(el, title.nextSibling);
      } else {
        document.body.appendChild(el);
      }
    }
    el.textContent = text;
  }

  function renderExistingUsers() {
    const container = document.getElementById("existing-users");
    const section = document.getElementById("existing-users-section");
    if (!container) return;

    const reg = loadRegistry();
    const wallets = getAllWallets();
    const userIds = Object.keys(wallets).sort((a, b) => a.localeCompare(b));

    container.innerHTML = "";
    container.className = userIds.length ? "stat-panel" : "";

    if (!userIds.length) {
      if (section) section.style.display = "none";
      return;
    }

    if (section) section.style.display = "block";

    for (const userId of userIds) {
      const wallet = wallets[userId];
      let summary = { total: 0, unpaid: 0, credit: 0 };
      try {
        summary = computeSummary(wallet);
      } catch (e) {
        // ignore
      }

      const card = document.createElement("div");
      card.className = "stat";

      const title = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = userId;
      title.appendChild(strong);

      const entry =
        reg && typeof reg === "object" && reg[userId] ? reg[userId] : null;
      const lastUpdated =
        entry &&
        typeof entry.lastUpdated === "number" &&
        Number.isFinite(entry.lastUpdated)
          ? entry.lastUpdated
          : 0;

      const meta = document.createElement("div");
      meta.style.marginTop = "0.35rem";
      meta.style.fontSize = "0.9rem";
      meta.style.color = "var(--muted)";
      meta.textContent = "Letztes Update: " + formatDateTime(lastUpdated);

      const summaryLine = document.createElement("div");
      summaryLine.style.marginTop = "0.35rem";
      summaryLine.textContent = `Total: ${summary.total} | Offen: ${summary.unpaid} | Guthaben: ${summary.credit}`;

      const actions = document.createElement("div");
      actions.className = "action-buttons";
      actions.style.marginTop = "0.6rem";

      const btnOpen = document.createElement("button");
      btnOpen.textContent = "Öffnen";
      btnOpen.addEventListener("click", () => {
        window.location.href = "wallet.html#" + userId;
      });

      const btnDelete = document.createElement("button");
      btnDelete.textContent = "Löschen";
      btnDelete.addEventListener("click", () => {
        const ok = window.confirm(
          `Soll die lokale Nutzer:in "${userId}" wirklich vollständig gelöscht werden?`,
        );
        if (!ok) return;

        safeLocalStorageRemoveItem(STORAGE_PREFIX + userId);
        safeLocalStorageRemoveItem(userId);

        const nextReg = loadRegistry();
        if (nextReg && typeof nextReg === "object" && nextReg[userId]) {
          delete nextReg[userId];
          saveRegistry(nextReg);
        }

        clearRawOutput();
        renderExistingUsers();
      });

      actions.appendChild(btnOpen);
      actions.appendChild(btnDelete);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(summaryLine);
      card.appendChild(actions);

      container.appendChild(card);
    }
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

    try {
      if (raw.startsWith("ac:")) {
        const actionApi = window.dbWalletActionCodes || null;
        const decoded =
          actionApi && typeof actionApi.decodeActionHash === "function"
            ? actionApi.decodeActionHash(raw)
            : null;
        return decoded && typeof decoded.walletId === "string"
          ? decoded.walletId
          : "";
      }

      if (raw.startsWith("import:")) {
        const payload = base64UrlDecode(raw.slice(7));
        const remote = safeParse(payload);
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }

      if (raw.startsWith("i2u:")) {
        const bytes = base64UrlDecodeBytes(raw.slice(4));
        const remote = decodeImportV2Bytes(bytes);
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }

      if (raw.startsWith("i2:")) {
        const bytes = base64UrlDecodeBytes(raw.slice(3));
        const decompressed = await gzipDecompress(bytes);
        const remote = decodeImportV2Bytes(decompressed);
        return remote && typeof remote.walletId === "string"
          ? remote.walletId
          : "";
      }
    } catch (e) {
      // ignore
    }

    return "";
  }

  function classifyHashValue(raw) {
    if (hashRouter && typeof hashRouter.classifyHash === "function") {
      return hashRouter.classifyHash(raw);
    }
    const value = String(raw || "");
    if (!value) return { kind: "none" };
    if (value.startsWith("acg:")) return { kind: "globalAction", raw: value };
    if (value.startsWith("ac:")) return { kind: "localAction", raw: value };
    if (
      value.startsWith("import:") ||
      value.startsWith("i2:") ||
      value.startsWith("i2u:")
    ) {
      return { kind: "import", raw: value };
    }
    const trimmed = value.trim();
    if (!trimmed) return { kind: "none" };
    return { kind: "user", userId: trimmed };
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

    if (!window.confirm(msg)) {
      window.location.hash = "";
      return false;
    }

    window.location.href = "wallet.html" + window.location.hash;
    return true;
  }

  function startNewUser() {
    const input = document.getElementById("username");
    const raw = input ? input.value : "";
    let userId = normalizeUserName(raw);
    userId = ensureNonReservedUserId(userId);
    if (userIdExists(userId)) {
      userId = makeUniqueUserId(userId);
    }
    window.location.href = "wallet.html#" + userId;
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

        const built = buildImportedWallet(remote);
        const userId =
          built && typeof built.userId === "string" ? built.userId : "";
        const wallet = built && built.wallet ? built.wallet : null;
        if (!userId || !wallet) {
          throw new Error("Ungültiges JSON-Format.");
        }

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

        if (mode === "preview" && openPreview) {
          openPreview({
            source: "json",
            wallet,
            theme: importedTheme,
          });
          return;
        }

        ensureDeviceSeq(wallet);
        saveWallet(wallet);
        applyImportedTheme(remote);

        renderExistingUsers();
        window.location.href = "wallet.html#" + userId;
      } catch (err) {
        alert(
          "Import fehlgeschlagen: " + (err && err.message ? err.message : err),
        );
      }
    };
    reader.readAsText(file);
  }

  function showRawAll() {
    const rawOutput = document.getElementById("raw-output");
    if (!rawOutput) return;

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

  function nukeAll() {
    let len = 0;
    try {
      len =
        typeof localStorage !== "undefined" && localStorage
          ? localStorage.length
          : 0;
    } catch (e) {
      len = 0;
    }

    const keysToDelete = [];
    for (let i = 0; i < len; i++) {
      let key = null;
      try {
        key = localStorage.key(i);
      } catch (e) {
        continue;
      }

      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      if (isReservedStorageKey(key)) continue;
      keysToDelete.push(key);
    }

    if (!keysToDelete.length) {
      alert("Es wurden keine lokalen Nutzer:innen gefunden.");
      return;
    }

    const userIds = keysToDelete
      .map((k) => k.slice(STORAGE_PREFIX.length))
      .sort((a, b) => a.localeCompare(b));

    const confirmMsg =
      userIds.length === 1
        ? `Soll die lokale Nutzer:in "${userIds[0]}" wirklich vollständig gelöscht werden?`
        : `Sollen die folgenden ${userIds.length} lokalen Nutzer:innen wirklich vollständig gelöscht werden?\n\n` +
          userIds.join(", ");

    if (!window.confirm(confirmMsg)) return;
    if (
      !window.confirm(
        "Wirklich ALLES löschen? Dieser Schritt kann nicht rückgängig gemacht werden.",
      )
    ) {
      return;
    }

    keysToDelete.forEach((key) => {
      const userId = key.slice(STORAGE_PREFIX.length);
      safeLocalStorageRemoveItem(key);
      safeLocalStorageRemoveItem(userId);
    });

    safeLocalStorageRemoveItem(REGISTRY_KEY);

    clearRawOutput();
    renderExistingUsers();
    alert("Alle lokalen db-wallet-Nutzer:innen wurden gelöscht.");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const inputUsername = document.getElementById("username");
    const btnStart = document.getElementById("btn-start");
    const btnInfo = document.getElementById("btn-info");
    const btnSearchUsers = document.getElementById("btn-search-users");
    const btnImportJson = document.getElementById("btn-import-json");
    const fileImport = document.getElementById("file-import");
    const btnRawAll = document.getElementById("btn-raw-all");
    const btnNukeAll = document.getElementById("btn-nuke-all");

    if (btnSearchUsers) {
      btnSearchUsers.textContent = "Neu laden";
      btnSearchUsers.addEventListener("click", () => renderExistingUsers());
    }

    if (btnStart) {
      btnStart.addEventListener("click", () => startNewUser());
    }
    if (inputUsername) {
      inputUsername.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startNewUser();
      });
    }

    if (btnInfo) {
      btnInfo.addEventListener("click", () => {
        window.open("https://github.com/bmmmm/db-wallet", "_blank");
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

    const redirected = await handleHashRouting();
    if (redirected) return;

    renderExistingUsers();
  });
})();
