(function () {
  function setNoWalletState() {
    if (typeof document !== "undefined" && document && document.body) {
      document.body.dataset.noWallet = "1";
    }
  }

  function clearNoWalletState() {
    if (
      typeof document !== "undefined" &&
      document &&
      document.body &&
      document.body.dataset
    ) {
      delete document.body.dataset.noWallet;
    }
  }

  function buildGlobalActionPreview(payload) {
    const type = payload && payload.t === "g" ? "g" : "d";
    const amount =
      payload && typeof payload.n === "number" && Number.isFinite(payload.n)
        ? Math.max(1, Math.round(payload.n))
        : 1;
    const label =
      payload && typeof payload.l === "string" ? payload.l.trim() : "";
    return { type, amount, label };
  }

  const CONTAINER_OPTIONS = {
    className: "action-codes-notice global-action-panel",
    anchors: [".top-row", "h1"],
  };

  function showMessage(message) {
    const api = window.dbWalletMessages;
    if (!api || typeof api.showGlobal !== "function") return null;
    return api.showGlobal(message, CONTAINER_OPTIONS);
  }

  function clearMessage() {
    const api = window.dbWalletMessages;
    if (api && typeof api.clearGlobal === "function") api.clearGlobal();
  }

  function showGlobalActionSelection(options) {
    const api = window.dbWalletMessages;
    if (!api || typeof api.ensureContainer !== "function") return;

    const userIds = Array.isArray(options.userIds) ? options.userIds : [];
    const walletMeta = options.walletMeta || {};
    const preview = buildGlobalActionPreview(options.payload);
    const onSelect = options.onSelect;
    const onCancel = options.onCancel;

    const el = api.ensureContainer(CONTAINER_OPTIONS);
    el.textContent = "";
    el.dataset.mode = "select";

    const header = document.createElement("div");
    header.className = "global-action-header";

    const headline = document.createElement("div");
    headline.className = "global-action-headline";
    if (preview.type === "d") {
      headline.textContent = `Yay! Du hast gerade +${preview.amount} Getränke am Start 🥤`;
    } else {
      headline.textContent = `Nice! Gutschein-Boost: +${preview.amount} Guthaben 💰`;
    }

    const labelLine = document.createElement("div");
    labelLine.className = "global-action-label";
    if (preview.label) {
      labelLine.textContent = `Code-Name: „${preview.label}“`;
    }

    const question = document.createElement("div");
    question.className = "global-action-subtitle";
    question.textContent = "Auf welches Wallet sollen wir das buchen?";

    header.appendChild(headline);
    if (preview.label) header.appendChild(labelLine);
    header.appendChild(question);

    const prompt = document.createElement("div");
    prompt.className = "global-action-prompt";
    prompt.textContent = "Wähle ein Wallet aus ✨";

    const list = document.createElement("div");
    list.id = "global-action-wallet-select";
    list.className = "global-action-options";

    let firstBtn = null;
    userIds.forEach((userId) => {
      const meta = walletMeta[userId] || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "global-action-card";

      const name = document.createElement("div");
      name.className = "global-action-card-title";
      name.textContent = userId;

      const sub = document.createElement("div");
      sub.className = "global-action-card-sub";
      const walletIdSnippet =
        typeof meta.walletIdSnippet === "string" ? meta.walletIdSnippet : "";
      sub.textContent = walletIdSnippet
        ? `Wallet-ID: ${walletIdSnippet}`
        : "";

      const metaLine = document.createElement("div");
      metaLine.className = "global-action-card-meta";
      const eventCount =
        typeof meta.eventCount === "number" && Number.isFinite(meta.eventCount)
          ? meta.eventCount
          : null;
      if (eventCount !== null) {
        metaLine.textContent = `Einträge: ${eventCount}`;
      }

      btn.appendChild(name);
      if (sub.textContent) btn.appendChild(sub);
      if (metaLine.textContent) btn.appendChild(metaLine);

      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const buttons = list.querySelectorAll("button");
        buttons.forEach((b) => {
          b.disabled = true;
        });
        if (typeof onSelect === "function") onSelect(userId);
      });
      if (!firstBtn) firstBtn = btn;
      list.appendChild(btn);
    });

    const actions = document.createElement("div");
    actions.className = "global-action-actions";

    if (typeof onCancel === "function") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "global-action-cancel";
      cancelBtn.textContent = "Abbrechen";
      cancelBtn.addEventListener("click", () => onCancel());
      actions.appendChild(cancelBtn);
    }

    el.appendChild(header);
    el.appendChild(prompt);
    el.appendChild(list);
    if (actions.childNodes.length) {
      el.appendChild(actions);
    }

    if (firstBtn) {
      setTimeout(() => {
        try {
          firstBtn.focus();
        } catch (e) {
          // ignore
        }
      }, 0);
    }
  }

  function awaitGlobalActionWalletSelection(options) {
    const userIds = Array.isArray(options.userIds) ? options.userIds : [];
    if (!userIds.length) return Promise.resolve({ action: "cancel", userId: "" });
    setNoWalletState();
    return new Promise((resolve) => {
      showGlobalActionSelection({
        userIds,
        walletMeta: options.walletMeta,
        payload: options.payload,
        onSelect: (userId) => {
          clearNoWalletState();
          clearMessage();
          resolve({ action: "select", userId });
        },
        onCancel: () => {
          clearNoWalletState();
          clearMessage();
          resolve({ action: "cancel", userId: options.lastUserId || "" });
        },
      });
    });
  }

  window.dbWalletHashActions = {
    setNoWalletState,
    clearNoWalletState,
    buildGlobalActionPreview,
    showGlobalActionSelection,
    awaitGlobalActionWalletSelection,
    showMessage,
    clearMessage,
  };
})();
