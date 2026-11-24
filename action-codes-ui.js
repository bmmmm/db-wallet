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
    canvas.toBlob((blob) => {
      if (blob) helpers.downloadBlob(blob, filename);
    }, "image/png");
  }

  // A file-name part: letters, digits, "_" and "-" only.
  function safeFilePart(text) {
    return String(text).replace(/[^a-zA-Z0-9_-]/g, "_");
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
    form.className = "action-code-form card card--flat";

    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.min = "1";
    amountInput.value = config.amount;
    ctx.focusRefs.form = amountInput;

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
        const result = createActionCode(walletNow, {
          scope: scopeToggle.getScope(),
          type: typeToggle.getType(),
          amount: amountInput.value,
          label: labelInput.value,
        });
        commit(ctx, result);
        ctx.createOpen = false;
        // On the new card (falls back to "Neuer Action Code" without one).
        ctx.pendingFocus = { what: "edit", id: result && result.code ? result.code.id : "" };
        ctx.refresh();
      },
      onCancel: () => {
        ctx.createOpen = false;
        ctx.pendingFocus = { what: "add" };
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
        ctx.editingId = "";
        if (result) commit(ctx, result);
        // Deleted in another tab meanwhile: the save keeps it deleted
        // (wallet.deletedActionCodes), so the edit is gone — say so.
        const kept = result && (!result.code || hasCode(ctx.getWallet(), result.code.id));
        if (!kept) {
          helpers.notify(
            "Dieser Action Code wurde inzwischen in einem anderen Tab gelöscht — die Änderung ist nicht gespeichert.",
            { kind: "error" },
          );
        }
        // A scope change gives the code a new id.
        ctx.pendingFocus = { what: "edit", id: kept && result.code ? result.code.id : code.id };
        ctx.refresh();
      },
      onCancel: () => {
        ctx.editingId = "";
        ctx.pendingFocus = { what: "edit", id: code.id };
        ctx.refresh();
      },
    });
  }

  function buildDeleteConfirm(ctx, code) {
    const deleteBox = document.createElement("div");
    deleteBox.className = "action-code-confirm card card--flat";

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
      ctx.pendingFocus = { what: "add" };
      ctx.refresh();
    });

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Abbrechen";
    btnCancel.addEventListener("click", () => {
      ctx.pendingDeleteId = "";
      ctx.pendingFocus = { what: "delete", id: code.id };
      ctx.refresh();
    });
    // The question gets the focus on its harmless answer.
    ctx.focusRefs.confirm = btnCancel;

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

    // Focus (without scrolling) and select the whole link.
    function selectUrl() {
      if (document.activeElement !== urlInput) {
        try {
          urlInput.focus({ preventScroll: true });
        } catch (e) {
          urlInput.focus();
        }
      }
      try {
        urlInput.select();
        urlInput.setSelectionRange(0, urlInput.value.length);
      } catch (e) {
        // ignore
      }
    }

    urlInput.addEventListener("focus", selectUrl);
    urlInput.addEventListener("click", selectUrl);

    const wallet = ctx.getWallet();
    const safeUserId = safeFilePart((wallet && wallet.userId) || "user");

    canvas.addEventListener("click", () => {
      if (!url || !job.drawn) return;
      const safeCode = safeFilePart(code.label || `+${code.amount}`).slice(0, 20);
      canvasToPngDownload(canvas, `db-wallet-${safeUserId}-action-${safeCode}.png`);
    });

    return { canvas, urlInput };
  }

  function buildActionCard(ctx, code, isSingle) {
    const isGlobal = normalizeScope(code && code.scope) === "global";
    const card = document.createElement("div");
    card.className = "action-code-card card";
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
      ctx.pendingFocus = { what: "form" };
      ctx.refresh();
    });

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.textContent = "Löschen";
    btnDelete.addEventListener("click", () => {
      ctx.pendingDeleteId = ctx.pendingDeleteId === code.id ? "" : code.id;
      ctx.editingId = "";
      ctx.createOpen = false;
      ctx.pendingFocus = ctx.pendingDeleteId
        ? { what: "confirm" }
        : { what: "delete", id: code.id };
      ctx.refresh();
    });
    ctx.focusRefs.cards.set(code.id, { edit: btnEdit, delete: btnDelete });

    btns.appendChild(btnEdit);
    btns.appendChild(btnDelete);

    head.appendChild(meta);
    head.appendChild(btns);

    card.appendChild(head);

    if (ctx.editingId === code.id) {
      card.appendChild(buildEditForm(ctx, code, isGlobal));
    } else if (ctx.pendingDeleteId === code.id) {
      card.appendChild(buildDeleteConfirm(ctx, code));
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
    // Same wallet as the last render? (A wallet switch closes an open form
    // without a word; a code gone from the same wallet was deleted elsewhere.)
    const walletKey = `${wallet.userId || ""}\n${wallet.walletId || ""}`;
    const sameWallet = walletKey === ctx.walletKey;
    ctx.walletKey = walletKey;
    ctx.signature = codesSignature(wallet);

    const localCodes = Array.isArray(wallet.actionCodes)
      ? wallet.actionCodes
      : [];
    const codes = localCodes.concat(getGlobalCodes(wallet));
    if (localCodes.length < SOFT_LIMIT) ctx.showSoftLimitNotice = false;
    if (ctx.editingId && !codes.find((c) => c && c.id === ctx.editingId)) {
      ctx.editingId = "";
      if (sameWallet) {
        helpers.notify("Der Action Code, der gerade bearbeitet wurde, wurde in einem anderen Tab gelöscht.");
      }
    }
    if (
      ctx.pendingDeleteId &&
      !codes.find((c) => c && c.id === ctx.pendingDeleteId)
    ) {
      ctx.pendingDeleteId = "";
    }

    ctx.container.innerHTML = "";
    ctx.container.classList.add("action-codes-body-inner");
    ctx.focusRefs = { add: null, form: null, confirm: null, cards: new Map() };

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
      ctx.pendingFocus = { what: ctx.createOpen ? "form" : "add" };
      ctx.refresh();
    });
    ctx.focusRefs.add = btnAdd;

    toolbar.appendChild(btnAdd);

    const hint = document.createElement("div");
    hint.className = "action-codes-hint";
    hint.textContent =
      "Diese QR-Codes buchen Drinks oder Guthaben auf dieses Wallet. Nach Änderungen bitte neu scannen/ausdrucken.";

    const notice = document.createElement("div");
    notice.className = "action-codes-notice card card--flat";
    notice.textContent =
      "Hinweis: Für Import/Export werden nur die 10 zuletzt aktiven Action Codes gespeichert. Ältere Codes wurden entfernt.";

    const softNotice = document.createElement("div");
    softNotice.className = "action-codes-notice card card--flat";
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
      applyPendingFocus(ctx);
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
    applyPendingFocus(ctx);
    drawQueuedQrs(ctx);
  }

  // A click re-renders the panel, so the clicked button is gone: the focus
  // goes where ctx.pendingFocus says, "Neuer Action Code" when that target
  // is not there (a deleted code, a failed save).
  function applyPendingFocus(ctx) {
    const want = ctx.pendingFocus;
    ctx.pendingFocus = null;
    if (!want) return;
    const refs = ctx.focusRefs;
    const cardRefs = want.id ? refs.cards.get(want.id) : null;
    let target = null;
    if (want.what === "form") target = refs.form;
    else if (want.what === "confirm") target = refs.confirm;
    else if (want.what === "edit") target = cardRefs && cardRefs.edit;
    else if (want.what === "delete") target = cardRefs && cardRefs.delete;
    target = target || refs.add;
    if (!target || typeof target.focus !== "function") return;
    try {
      target.focus();
    } catch (e) {
      // ignore
    }
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

  function hasCode(wallet, id) {
    const local = wallet && Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];
    return local.concat(getGlobalCodes(wallet)).some((c) => c && c.id === id);
  }

  // What the panel shows of a wallet: a change elsewhere that leaves this
  // alone (a booking) needs no re-render.
  function codesSignature(wallet) {
    return JSON.stringify([
      wallet.userId,
      wallet.walletId,
      wallet.actionCodes || [],
      wallet.globalActionCodes || [],
    ]);
  }

  // options: container, getWallet, persistWallet(next), getBaseUrl (all
  // required), panel (optional). Returns refresh() (always re-renders) and
  // sync() (re-renders only when the wallet's codes changed, e.g. after
  // another tab saved; an open form keeps what was typed otherwise).
  function initActionCodesUi(options) {
    const o = options || {};
    if (
      !o.container ||
      typeof o.getWallet !== "function" ||
      typeof o.persistWallet !== "function" ||
      typeof o.getBaseUrl !== "function"
    ) {
      return { refresh: () => {}, sync: () => false };
    }

    const ctx = {
      container: o.container,
      getWallet: o.getWallet,
      persistWallet: o.persistWallet,
      getBaseUrl: o.getBaseUrl,
      // The <details> around the panel: QR cards are drawn while it is open.
      // Without one they are drawn at once.
      panel: o.panel || null,
      qrQueue: [],
      renderGen: 0,
      showTrimNotice: false,
      showSoftLimitNotice: false,
      selectedType: "d",
      selectedScope: "local",
      createOpen: false,
      editingId: "",
      pendingDeleteId: "",
      walletKey: "",
      signature: "",
      // Where the focus goes after the next render (applyPendingFocus) and
      // the elements of the last render it can go to.
      pendingFocus: null,
      focusRefs: { add: null, form: null, confirm: null, cards: new Map() },
      refresh: null,
    };
    ctx.refresh = () => renderActionList(ctx);
    const sync = () => {
      const wallet = ctx.getWallet();
      if (!wallet || codesSignature(wallet) === ctx.signature) return false;
      renderActionList(ctx);
      return true;
    };
    if (ctx.panel && typeof ctx.panel.addEventListener === "function") {
      ctx.panel.addEventListener("toggle", () => drawQueuedQrs(ctx));
    }

    ctx.refresh();
    return { refresh: ctx.refresh, sync };
  }

  window.dbWalletActionCodesUI = { initActionCodesUi };
})();
