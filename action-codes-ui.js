// Action-code panel (DOM): the list of local and global codes with their QR
// cards, and the create / edit / delete forms. Every change goes through the
// pure functions in action-codes.js (createActionCode, editActionCode,
// deleteActionCode) and is saved once via ctx.persistWallet. Loaded on
// wallet.html only, after action-codes.js; index.html needs just the logic.
(function () {
  const helpers = window.dbWalletHelpers || null;
  const api = window.dbWalletActionCodes || null;
  if (
    !helpers ||
    typeof helpers.drawQrToCanvas !== "function" ||
    typeof helpers.loadQrLibrary !== "function" ||
    typeof helpers.downloadBlob !== "function" ||
    !api ||
    typeof api.createActionCode !== "function"
  ) {
    return;
  }
  const {
    normalizeAmount,
    normalizeType,
    normalizeScope,
    clampGlobalAmount,
    defaultLabelForType,
    amountPromptForType,
    ensureWalletActionCodes,
    createActionCode,
    editActionCode,
    deleteActionCode,
    buildActionUrl,
    HARD_LIMIT,
    SOFT_LIMIT,
    GLOBAL_ACTION_MAX_AMOUNT,
  } = api;

  function canvasToPngDownload(canvas, filename) {
    if (!canvas) return;
    const saveBlob = (blob) => {
      if (typeof helpers.downloadBlob === "function") helpers.downloadBlob(blob, filename);
    };

    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) saveBlob(blob);
      }, "image/png");
      return;
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderQrToCanvas(canvas, url) {
    if (!canvas) return;
    helpers.drawQrToCanvas(canvas, String(url || ""), { scale: 6 });
  }

  function persistIfChanged(ctx, wallet) {
    const current = Array.isArray(wallet && wallet.actionCodes)
      ? wallet.actionCodes
      : [];
    if (current.length > HARD_LIMIT) ctx.showTrimNotice = true;
    const res = ensureWalletActionCodes(wallet);
    if (res && res.trimmedCount > 0) ctx.showTrimNotice = true;
    if (res && res.changed) ctx.persistWallet(wallet);
  }

  function actionUrlFor(ctx, code) {
    return buildActionUrl(ctx.getWallet(), code, ctx.getBaseUrl());
  }

  // Saves the result of a pure code change (action-codes.js) with one save.
  function commit(ctx, result) {
    if (!result) return false;
    if (result.trimmedCount > 0) ctx.showTrimNotice = true;
    ctx.persistWallet(result.wallet);
    return true;
  }

  // Generic two-button toggle backing both the type toggle (Drink/Credit) and
  // the scope toggle (Local/Global) — same DOM shape, classes, and
  // aria-pressed behavior, just different option sets.
  function buildToggle({ className, options, initial, normalize, onChange }) {
    let current = normalize ? normalize(initial) : initial;
    const wrapper = document.createElement("div");
    wrapper.className = className;

    const buttons = options.map((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.className = "mode-btn";
      btn.setAttribute("aria-pressed", "false");
      return btn;
    });

    function sync() {
      current = normalize ? normalize(current) : current;
      options.forEach((opt, i) => {
        const active = opt.value === current;
        buttons[i].classList.toggle("active", active);
        buttons[i].setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    options.forEach((opt, i) => {
      buttons[i].addEventListener("click", () => {
        current = opt.value;
        sync();
        if (onChange) onChange(current);
      });
    });

    sync();
    for (const btn of buttons) wrapper.appendChild(btn);

    return {
      el: wrapper,
      getValue: () => current,
      setValue: (value) => {
        current = normalize ? normalize(value) : value;
        sync();
      },
    };
  }

  function buildTypeToggle(initialType, onChange) {
    const toggle = buildToggle({
      className: "action-code-type-toggle",
      options: [
        { value: "d", label: "🥤 Trinken" },
        { value: "g", label: "💰 Guthaben" },
      ],
      initial: initialType,
      normalize: normalizeType,
      onChange,
    });
    return { el: toggle.el, getType: toggle.getValue, setType: toggle.setValue };
  }

  function buildScopeToggle(initialScope, onChange) {
    const toggle = buildToggle({
      className: "action-code-scope-toggle",
      options: [
        { value: "local", label: "🔒 Lokal" },
        { value: "global", label: "🌍 Global" },
      ],
      initial: initialScope,
      normalize: normalizeScope,
      onChange,
    });
    return { el: toggle.el, getScope: toggle.getValue, setScope: toggle.setValue };
  }

  // Shared scaffolding for the create and edit forms: amount/label inputs,
  // scope+type toggles, amount clamping, and save/cancel wiring. Callers
  // supply the initial values plus the mode-specific persist logic.
  function buildCodeForm(ctx, config) {
    const form = document.createElement("div");
    form.className = "action-code-form";

    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.min = "1";
    amountInput.value = config.amount;

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = config.label;

    let autoLabel = config.autoLabel ? config.label : null;

    const amountField = document.createElement("label");
    amountField.className = "action-code-form-field";
    const amountText = document.createElement("span");
    amountText.textContent = amountPromptForType(config.type);
    amountField.appendChild(amountText);
    amountField.appendChild(amountInput);

    const labelField = document.createElement("label");
    labelField.className = "action-code-form-field";
    const labelText = document.createElement("span");
    labelText.textContent = "Name für den Action Code:";
    labelField.appendChild(labelText);
    labelField.appendChild(labelInput);

    const scopeToggle = buildScopeToggle(config.scope, (nextScope) => {
      if (config.onScopeChange) config.onScopeChange(nextScope);
      updateAmountLimit();
    });
    const typeToggle = buildTypeToggle(config.type, (nextType) => {
      if (config.onTypeChange) config.onTypeChange(nextType);
      if (config.autoLabel) updateDefaults(nextType);
      amountText.textContent = amountPromptForType(nextType);
    });

    function updateDefaults(nextType) {
      const nextDefault = defaultLabelForType(nextType, amountInput.value);
      const current = labelInput.value.trim();
      if (!current || current === autoLabel) {
        labelInput.value = nextDefault;
      }
      autoLabel = nextDefault;
    }

    function updateAmountLimit() {
      const scope = scopeToggle.getScope();
      if (scope === "global") {
        amountInput.max = String(GLOBAL_ACTION_MAX_AMOUNT);
        const normalized = clampGlobalAmount(amountInput.value);
        if (normalized !== null) {
          amountInput.value = String(normalized);
        }
      } else {
        amountInput.removeAttribute("max");
      }
    }

    amountInput.addEventListener("input", () => {
      if (config.autoLabel) updateDefaults(typeToggle.getType());
      updateAmountLimit();
    });

    const fields = document.createElement("div");
    fields.className = "action-code-form-fields";
    fields.appendChild(amountField);
    fields.appendChild(labelField);

    const actions = document.createElement("div");
    actions.className = "action-code-form-actions";

    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.textContent = "Speichern";
    btnSave.addEventListener("click", () => {
      config.onSave({ scopeToggle, typeToggle, amountInput, labelInput });
    });

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Abbrechen";
    btnCancel.addEventListener("click", () => {
      config.onCancel();
    });

    actions.appendChild(btnSave);
    actions.appendChild(btnCancel);

    updateAmountLimit();
    form.appendChild(scopeToggle.el);
    form.appendChild(typeToggle.el);
    form.appendChild(fields);
    form.appendChild(actions);

    return form;
  }

  function buildCreateForm(ctx) {
    const initialAmount = "10";
    const initialLabel = defaultLabelForType(ctx.selectedType, initialAmount);
    return buildCodeForm(ctx, {
      scope: ctx.selectedScope,
      type: ctx.selectedType,
      amount: initialAmount,
      label: initialLabel,
      autoLabel: true,
      onScopeChange: (nextScope) => {
        ctx.selectedScope = nextScope;
      },
      onTypeChange: (nextType) => {
        ctx.selectedType = nextType;
      },
      onSave: ({ scopeToggle, typeToggle, amountInput, labelInput }) => {
        const walletNow = ctx.getWallet();
        if (!walletNow) return;
        const scope = scopeToggle.getScope();
        const hadNoLocalCodes = !(
          Array.isArray(walletNow.actionCodes) && walletNow.actionCodes.length
        );
        commit(
          ctx,
          createActionCode(walletNow, {
            scope,
            type: typeToggle.getType(),
            amount: amountInput.value,
            label: labelInput.value,
          }),
        );
        if (scope !== "global" && hadNoLocalCodes) {
          const details =
            typeof ctx.container.closest === "function"
              ? ctx.container.closest("details")
              : null;
          if (details) details.open = true;
        }
        ctx.createOpen = false;
        ctx.refresh();
      },
      onCancel: () => {
        ctx.createOpen = false;
        ctx.refresh();
      },
    });
  }

  function buildEditForm(ctx, code, isGlobal) {
    const initialAmount = String(code.amount || 1);
    const initialLabel =
      code.label ||
      defaultLabelForType(code.type, normalizeAmount(code.amount));
    return buildCodeForm(ctx, {
      scope: isGlobal ? "global" : "local",
      type: code.type,
      amount: initialAmount,
      label: initialLabel,
      autoLabel: false,
      onSave: ({ scopeToggle, typeToggle, amountInput, labelInput }) => {
        const walletNow = ctx.getWallet();
        if (!walletNow) return;
        const result = editActionCode(walletNow, code.id, {
          scope: scopeToggle.getScope(),
          type: typeToggle.getType(),
          amount: amountInput.value,
          label: labelInput.value,
        });
        if (!result) return;
        commit(ctx, result);
        ctx.editingId = "";
        ctx.refresh();
      },
      onCancel: () => {
        ctx.editingId = "";
        ctx.refresh();
      },
    });
  }

  function buildDeleteConfirm(ctx, code, isGlobal) {
    const deleteBox = document.createElement("div");
    deleteBox.className = "action-code-confirm";

    const deleteText = document.createElement("div");
    deleteText.textContent = `Action Code "${code.label || `+${code.amount}`}" löschen?`;

    const deleteActions = document.createElement("div");
    deleteActions.className = "action-code-form-actions";

    const btnConfirm = document.createElement("button");
    btnConfirm.type = "button";
    btnConfirm.textContent = "Löschen";
    btnConfirm.addEventListener("click", () => {
      const walletNow = ctx.getWallet();
      if (!walletNow) return;
      commit(ctx, deleteActionCode(walletNow, code.id));
      ctx.pendingDeleteId = "";
      ctx.refresh();
    });

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Abbrechen";
    btnCancel.addEventListener("click", () => {
      ctx.pendingDeleteId = "";
      ctx.refresh();
    });

    deleteActions.appendChild(btnConfirm);
    deleteActions.appendChild(btnCancel);

    deleteBox.appendChild(deleteText);
    deleteBox.appendChild(deleteActions);

    return deleteBox;
  }

  function buildQrCard(ctx, code) {
    const canvas = document.createElement("canvas");
    canvas.className = "action-code-canvas";

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.readOnly = true;
    urlInput.inputMode = "none";
    urlInput.className = "action-code-url";
    urlInput.setAttribute("aria-label", "Action Code Link");

    let url = "";
    try {
      url = actionUrlFor(ctx, code);
      urlInput.value = url;
    } catch (e) {
      const fallback = document.createElement("div");
      fallback.className = "action-code-error";
      fallback.textContent = "QR-Code konnte nicht erzeugt werden.";
      return { error: fallback };
    }
    // Drawn later, once the panel is open (drawQueuedQrs); a 1×1 canvas keeps
    // the square place meanwhile.
    canvas.width = 1;
    canvas.height = 1;
    const job = { canvas, url, drawn: false };
    ctx.qrQueue.push(job);

    function selectUrl() {
      try {
        urlInput.focus({ preventScroll: true });
      } catch (e) {
        urlInput.focus();
      }
      urlInput.select();
      try {
        urlInput.setSelectionRange(0, urlInput.value.length);
      } catch (e) {}
    }

    urlInput.addEventListener("focus", selectUrl);
    urlInput.addEventListener("click", selectUrl);

    const wallet = ctx.getWallet();
    const safeUserId = String((wallet && wallet.userId) || "user").replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );

    canvas.addEventListener("click", () => {
      if (!url || !job.drawn) return;
      const safeCode = String(code.label || `+${code.amount}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 20);
      const filename = `db-wallet-${safeUserId}-action-${safeCode}.png`;
      canvasToPngDownload(canvas, filename);
    });

    return { canvas, urlInput };
  }

  function buildActionCard(ctx, code, isSingle) {
    const isGlobal = normalizeScope(code && code.scope) === "global";
    const card = document.createElement("div");
    card.className = "action-code-card";
    if (isSingle) card.classList.add("action-code-card--featured");

    const head = document.createElement("div");
    head.className = "action-code-head";

    const meta = document.createElement("div");
    meta.className = "action-code-meta";

    const badge = document.createElement("span");
    badge.className = "action-code-badge";
    badge.textContent = isGlobal ? "🌍 Global" : "🔒 Lokal";

    const label = document.createElement("div");
    label.className = "action-code-label";
    label.textContent = code.label || `+${code.amount}`;

    const amount = document.createElement("div");
    amount.className = "action-code-amount";
    const typeLabel = code.type === "d" ? "Drink" : "Guthaben";
    amount.textContent = `+${normalizeAmount(code.amount)} Getränke (${typeLabel})`;

    const labelRow = document.createElement("div");
    labelRow.className = "action-code-label-row";
    labelRow.appendChild(label);
    labelRow.appendChild(badge);

    meta.appendChild(labelRow);
    meta.appendChild(amount);

    const btns = document.createElement("div");
    btns.className = "action-code-buttons";

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Bearbeiten";
    btnEdit.addEventListener("click", () => {
      ctx.editingId = code.id;
      ctx.pendingDeleteId = "";
      ctx.createOpen = false;
      ctx.refresh();
    });

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.textContent = "Löschen";
    btnDelete.addEventListener("click", () => {
      ctx.pendingDeleteId = ctx.pendingDeleteId === code.id ? "" : code.id;
      ctx.editingId = "";
      ctx.createOpen = false;
      ctx.refresh();
    });

    btns.appendChild(btnEdit);
    btns.appendChild(btnDelete);

    head.appendChild(meta);
    head.appendChild(btns);

    card.appendChild(head);

    if (ctx.editingId === code.id) {
      card.appendChild(buildEditForm(ctx, code, isGlobal));
    } else if (ctx.pendingDeleteId === code.id) {
      card.appendChild(buildDeleteConfirm(ctx, code, isGlobal));
    } else {
      const qr = buildQrCard(ctx, code);
      if (qr.error) {
        card.appendChild(qr.error);
      } else {
        card.appendChild(qr.canvas);
        card.appendChild(qr.urlInput);
      }
    }

    return card;
  }

  function showQrError(job, text) {
    const err = document.createElement("div");
    err.className = "action-code-error";
    err.textContent = text;
    job.canvas.insertAdjacentElement("beforebegin", err);
    job.canvas.hidden = true;
  }

  // P5.6: the QR cards of the latest render are drawn only while the panel is
  // open — a closed <details> needs no canvases, and qrcodegen.js loads on
  // first use (helpers.loadQrLibrary). Opening the panel draws the queue; a
  // re-render replaces it, so a pending draw of an older render is dropped.
  function drawQueuedQrs(ctx) {
    if (ctx.panel && !ctx.panel.open) return;
    const jobs = ctx.qrQueue;
    if (!jobs.length) return;
    ctx.qrQueue = [];
    const gen = ctx.renderGen;
    helpers.loadQrLibrary().then(
      () => {
        if (gen !== ctx.renderGen) return;
        for (const job of jobs) {
          try {
            renderQrToCanvas(job.canvas, job.url);
            job.drawn = true;
          } catch (e) {
            showQrError(job, "QR-Code konnte nicht erzeugt werden.");
          }
        }
      },
      () => {
        if (gen !== ctx.renderGen) return;
        for (const job of jobs) showQrError(job, "QR-Code-Generator fehlt (qrcodegen.js).");
      },
    );
  }

  function renderActionList(ctx) {
    const wallet = ctx.getWallet();
    if (!wallet) return;
    ctx.renderGen++;
    ctx.qrQueue = [];

    persistIfChanged(ctx, wallet);

    const localCodes = Array.isArray(wallet.actionCodes)
      ? wallet.actionCodes
      : [];
    const codes = localCodes.concat(getGlobalCodes(wallet));
    if (localCodes.length < SOFT_LIMIT) ctx.showSoftLimitNotice = false;
    if (ctx.editingId && !codes.find((c) => c && c.id === ctx.editingId)) {
      ctx.editingId = "";
    }
    if (
      ctx.pendingDeleteId &&
      !codes.find((c) => c && c.id === ctx.pendingDeleteId)
    ) {
      ctx.pendingDeleteId = "";
    }

    ctx.container.innerHTML = "";
    ctx.container.classList.add("action-codes-body-inner");

    const toolbar = document.createElement("div");
    toolbar.className = "action-codes-toolbar";

    const btnAdd = document.createElement("button");
    btnAdd.type = "button";
    btnAdd.textContent = "Neuer Action Code";
    btnAdd.addEventListener("click", () => {
      const walletNow = ctx.getWallet();
      if (!walletNow) return;
      persistIfChanged(ctx, walletNow);
      const currentCodes = Array.isArray(walletNow.actionCodes)
        ? walletNow.actionCodes
        : [];
      if (currentCodes.length >= SOFT_LIMIT) ctx.showSoftLimitNotice = true;
      ctx.createOpen = !ctx.createOpen;
      ctx.editingId = "";
      ctx.pendingDeleteId = "";
      ctx.refresh();
    });

    toolbar.appendChild(btnAdd);

    const hint = document.createElement("div");
    hint.className = "action-codes-hint";
    hint.textContent =
      "Diese QR-Codes buchen Drinks oder Guthaben auf dieses Wallet. Nach Änderungen bitte neu scannen/ausdrucken.";

    const notice = document.createElement("div");
    notice.className = "action-codes-notice";
    notice.textContent =
      "Hinweis: Für Import/Export werden nur die 10 zuletzt aktiven Action Codes gespeichert. Ältere Codes wurden entfernt.";

    const softNotice = document.createElement("div");
    softNotice.className = "action-codes-notice";
    softNotice.textContent =
      "Empfohlen: max. 6 Action Codes. Ab 10 werden automatisch nur die 10 zuletzt aktiven gespeichert (ältere werden entfernt).";

    if (!codes.length) {
      const empty = document.createElement("div");
      empty.className = "action-codes-empty";
      empty.textContent =
        "Noch keine Action Codes – klicke auf „Neuer Action Code“.";
      ctx.container.appendChild(toolbar);
      ctx.container.appendChild(hint);
      if (ctx.showSoftLimitNotice) {
        ctx.container.appendChild(softNotice);
        ctx.showSoftLimitNotice = false;
      }
      if (ctx.showTrimNotice) ctx.container.appendChild(notice);
      if (ctx.createOpen) ctx.container.appendChild(buildCreateForm(ctx));
      ctx.container.appendChild(empty);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "action-codes-grid";
    if (codes.length === 1) grid.classList.add("action-codes-grid--single");

    for (const code of codes) {
      grid.appendChild(buildActionCard(ctx, code, codes.length === 1));
    }

    ctx.container.appendChild(toolbar);
    ctx.container.appendChild(hint);
    if (ctx.showSoftLimitNotice) {
      ctx.container.appendChild(softNotice);
      ctx.showSoftLimitNotice = false;
    }
    if (ctx.showTrimNotice) ctx.container.appendChild(notice);
    if (ctx.createOpen) ctx.container.appendChild(buildCreateForm(ctx));
    ctx.container.appendChild(grid);
    drawQueuedQrs(ctx);
  }

  // Global ('🌍') codes live on the wallet (wallet.globalActionCodes) and only
  // there: the panel reads them from ctx.getWallet() on every render and
  // writes them back to that same wallet. No panel-level copy — a copy seeded
  // once on init leaked wallet A's codes into wallet B after a wallet switch.
  function getGlobalCodes(wallet) {
    return wallet && Array.isArray(wallet.globalActionCodes)
      ? wallet.globalActionCodes
      : [];
  }

  function initActionCodesUi(options) {
    const container = options && options.container;
    if (!container) return { refresh: () => {} };

    const ctx = {
      container,
      getWallet:
        options && typeof options.getWallet === "function"
          ? options.getWallet
          : () => null,
      persistWallet:
        options && typeof options.persistWallet === "function"
          ? options.persistWallet
          : () => {},
      getBaseUrl:
        options && typeof options.getBaseUrl === "function"
          ? options.getBaseUrl
          : () => String(window.location.href || "").split("#")[0],
      // The <details> around the panel: QR cards are drawn while it is open.
      // Without one they are drawn at once.
      panel: (options && options.panel) || null,
      qrQueue: [],
      renderGen: 0,
      showTrimNotice: false,
      showSoftLimitNotice: false,
      selectedType: "d",
      selectedScope: "local",
      createOpen: false,
      editingId: "",
      pendingDeleteId: "",
      refresh: null,
    };
    ctx.refresh = () => renderActionList(ctx);
    if (ctx.panel && typeof ctx.panel.addEventListener === "function") {
      ctx.panel.addEventListener("toggle", () => drawQueuedQrs(ctx));
    }

    ctx.refresh();
    return { refresh: ctx.refresh };
  }

  window.dbWalletActionCodesUI = { initActionCodesUi };
})();
