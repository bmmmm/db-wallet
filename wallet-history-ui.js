(function () {
  const summaryApi = window.dbWalletSummary || null;
  if (!summaryApi) return;

  // P4.4: "Historie" renders this many rows per step; "Ältere anzeigen" adds
  // the next step (a long log stays a cheap DOM write).
  const LIST_STEP = 200;

  let historyMode = "diagram"; // "diagram" | "log" | "raw"
  let rawScope = "current"; // "current" | "all"
  let rawAllCache = null;
  let rawCurrentCache = null;
  let listLimit = LIST_STEP;

  // The open edit form, keyed by the entry's root id: {root, values: {date,
  // amount}}. It survives re-renders (a booking in another tab re-renders the
  // list) together with what was typed.
  let editState = null;
  // What gets the focus after the next render: {root, what} with what =
  // "date" | "amount" | "edit" (the row's "Bearbeiten") | "more".
  let pendingFocus = null;
  // The form currently in the DOM ({root, date, amount}) and the buttons of
  // every rendered row (root → {edit, del}), to read values / move focus.
  let currentForm = null;
  let rowButtons = new Map();
  let rowOrder = [];

  let refs = null;
  let getWallet = null;
  let getSummary = null;
  let getAllWallets = null;
  let onAfterRender = null;
  let onEditEntry = null;
  let onDeleteEntry = null;
  let limits = { drinkMax: 99, creditMax: 999 };

  function setPressed(btn, on) {
    if (!btn) return;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function editingEnabled() {
    return !!(refs.logEditToggle && refs.logEditToggle.checked);
  }

  function setHistoryMode(mode) {
    historyMode = mode;
    setPressed(refs.btnModeDiagram, mode === "diagram");
    setPressed(refs.btnModeLog, mode === "log");
    setPressed(refs.btnModeRaw, mode === "raw");

    // Raw-Scope-Toggle nur im Raw-Log-Modus anzeigen
    if (refs.rawToggle) {
      refs.rawToggle.style.display = mode === "raw" ? "block" : "none";
    }

    // Log-editing tools are only visible in history mode, the reset button
    // only once the checkbox is enabled.
    if (refs.logTools) {
      if (mode === "log") {
        refs.logTools.style.display = "block";
        if (refs.logEditGroup) {
          refs.logEditGroup.style.display = editingEnabled() ? "block" : "none";
        }
      } else {
        refs.logTools.style.display = "none";
      }
    }

    // The list replaces the <pre> in history mode.
    if (refs.elHistoryList) {
      refs.elHistoryList.style.display = mode === "log" ? "block" : "none";
      refs.elHistory.style.display = mode === "log" ? "none" : "block";
    }
    if (mode !== "log") editState = null;

    // Switching to diagram or history always resets the raw scope to the current user
    if (mode !== "raw") {
      setRawScope("current");
    }

    window.dbWalletHistoryUI.render();
  }

  function setRawScope(scope) {
    rawScope = scope;
    if (scope !== "all") {
      rawAllCache = null;
    }
    setPressed(refs.btnRawCurrent, scope === "current");
    setPressed(refs.btnRawAll, scope === "all");
    if (historyMode === "raw") {
      window.dbWalletHistoryUI.render();
    }
  }

  const formatPerDayDiagram = summaryApi.formatPerDayDiagram;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function makeButton(label, cls) {
    const b = el("button", cls, label);
    b.type = "button";
    return b;
  }

  function focusEl(node) {
    if (!node || typeof node.focus !== "function") return;
    try {
      node.focus();
    } catch (e) {
      // ignore
    }
  }

  function entryValues(e) {
    return {
      date: summaryApi.dateStrFromTimestamp(e.ts),
      amount:
        e.t === "p"
          ? ""
          : String(typeof e.n === "number" && isFinite(e.n) ? Math.max(1, Math.round(e.n)) : 1),
    };
  }

  // Keeps what was typed into the open form (and where the cursor was)
  // across a re-render.
  function captureForm() {
    if (!currentForm || !editState || currentForm.root !== editState.root) return;
    editState.values = {
      date: currentForm.date.value,
      amount: currentForm.amount ? currentForm.amount.value : "",
    };
    if (pendingFocus) return;
    const active = document.activeElement;
    if (active && active === currentForm.date) {
      pendingFocus = { root: editState.root, what: "date" };
    } else if (active && currentForm.amount && active === currentForm.amount) {
      pendingFocus = { root: editState.root, what: "amount" };
    }
  }

  function closeForm(root) {
    editState = null;
    pendingFocus = { root, what: "edit" };
    window.dbWalletHistoryUI.render();
  }

  function submitForm(root) {
    if (!currentForm || currentForm.root !== root) return;
    const values = {
      date: currentForm.date.value,
      amount: currentForm.amount ? currentForm.amount.value : "",
    };
    // Close before saving: the save re-renders the list (onStateChanged),
    // which then shows the closed row and focuses its button. On an error
    // nothing re-rendered, so the form simply stays as it is.
    editState = null;
    pendingFocus = { root, what: "edit" };
    let ok = false;
    try {
      ok = typeof onEditEntry === "function" && onEditEntry(root, values) === true;
    } finally {
      if (!ok) {
        editState = { root, values };
        pendingFocus = null;
      }
    }
    // "Keine Änderung" saves nothing and does not re-render.
    if (ok && pendingFocus) window.dbWalletHistoryUI.render();
  }

  function renderForm(e, root) {
    const values = editState.values;
    const form = el("form", "history-edit-form");
    form.noValidate = true;

    const dateLabel = el("label", "history-edit-field");
    dateLabel.appendChild(el("span", null, "Datum"));
    const date = el("input");
    date.type = "date";
    date.value = values.date;
    date.max = summaryApi.todayDateStr();
    date.required = true;
    dateLabel.appendChild(date);
    form.appendChild(dateLabel);

    let amount = null;
    if (e.t !== "p") {
      const amountLabel = el("label", "history-edit-field");
      amountLabel.appendChild(el("span", null, e.t === "g" ? "Guthaben" : "Getränke"));
      amount = el("input");
      amount.type = "number";
      amount.min = "1";
      const max = e.t === "d" ? limits.drinkMax : e.t === "g" ? limits.creditMax : 0;
      if (max) amount.max = String(max);
      amount.inputMode = "numeric";
      amount.value = values.amount;
      amountLabel.appendChild(amount);
      form.appendChild(amountLabel);
    }

    const buttons = el("div", "history-edit-buttons");
    const save = el("button", "history-edit-save", "Speichern");
    save.type = "submit";
    const cancel = makeButton("Abbrechen", "history-edit-cancel");
    buttons.appendChild(save);
    buttons.appendChild(cancel);
    form.appendChild(buttons);

    form.addEventListener("submit", (ev) => {
      // CSP form-action 'none': the form must never really submit.
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      submitForm(root);
    });
    cancel.addEventListener("click", () => closeForm(root));
    form.addEventListener("keydown", (ev) => {
      if (!ev || ev.key !== "Escape") return;
      if (typeof ev.preventDefault === "function") ev.preventDefault();
      closeForm(root);
    });

    currentForm = { root, date, amount };
    return form;
  }

  function renderRow(e, editable) {
    const root = summaryApi.rootIdOf(e);
    const li = el("li", "history-row");
    const label = summaryApi.formatEntryText(e) + (e.supersedes ? " (bearbeitet)" : "");
    li.appendChild(el("span", "history-row-text", label));
    if (!editable || !root) return li;

    const editing = !!editState && editState.root === root;
    const actions = el("span", "history-row-actions");
    const bEdit = makeButton("Bearbeiten", "history-row-edit");
    bEdit.setAttribute("aria-label", `Bearbeiten: ${label}`);
    bEdit.setAttribute("aria-expanded", editing ? "true" : "false");
    bEdit.addEventListener("click", () => {
      if (editState && editState.root === root) {
        closeForm(root);
        return;
      }
      editState = { root, values: entryValues(e) };
      pendingFocus = { root, what: "date" };
      window.dbWalletHistoryUI.render();
    });
    const bDel = makeButton("Löschen", "history-row-delete");
    bDel.setAttribute("aria-label", `Löschen: ${label}`);
    bDel.addEventListener("click", () => {
      if (typeof onDeleteEntry !== "function") return;
      const i = rowOrder.indexOf(root);
      const neighbor = rowOrder[i + 1] || rowOrder[i - 1] || null;
      Promise.resolve(onDeleteEntry(root)).then((ok) => {
        if (ok !== true) return;
        // The row is gone: the focus moves to the next one (or the list).
        const next = neighbor && rowButtons.get(neighbor);
        focusEl(next ? next.del : refs.elHistoryList);
      });
    });
    actions.appendChild(bEdit);
    actions.appendChild(bDel);
    li.appendChild(actions);
    rowButtons.set(root, { edit: bEdit, del: bDel });

    if (editing) li.appendChild(renderForm(e, root));
    return li;
  }

  function renderList(summary) {
    const list = refs.elHistoryList;
    captureForm();
    currentForm = null;
    rowButtons = new Map();
    rowOrder = [];
    list.textContent = "";

    const entries = summary.eventsEffectiveSorted || [];
    const editable = editingEnabled();
    if (
      editState &&
      (!editable || !entries.some((e) => summaryApi.rootIdOf(e) === editState.root))
    ) {
      // Switched off, or the entry was deleted (here or in another tab).
      editState = null;
    }
    if (!entries.length) {
      list.appendChild(el("li", "history-empty", "Noch keine Drinks geloggt. ✨"));
      return;
    }

    const shown = Math.min(entries.length, listLimit);
    for (let k = 0; k < shown; k++) {
      const e = entries[entries.length - 1 - k]; // newest first
      rowOrder.push(summaryApi.rootIdOf(e));
      list.appendChild(renderRow(e, editable));
    }
    let more = null;
    if (entries.length > shown) {
      const li = el("li", "history-more");
      more = makeButton(
        `Ältere anzeigen (${Math.min(entries.length - shown, LIST_STEP)})`,
        "history-more-btn",
      );
      more.addEventListener("click", () => {
        listLimit += LIST_STEP;
        pendingFocus = { root: null, what: "more" };
        window.dbWalletHistoryUI.render();
      });
      li.appendChild(more);
      list.appendChild(li);
    }

    const want = pendingFocus;
    pendingFocus = null;
    if (!want) return;
    if (want.what === "more") {
      focusEl(more || list);
    } else if (want.what === "edit") {
      const b = rowButtons.get(want.root);
      focusEl(b ? b.edit : list);
    } else if (currentForm && currentForm.root === want.root) {
      focusEl(want.what === "amount" && currentForm.amount ? currentForm.amount : currentForm.date);
    }
  }

  window.dbWalletHistoryUI = {
    init(params) {
      refs = params.refs;
      getWallet = params.getWallet;
      getSummary = params.getSummary;
      getAllWallets = params.getAllWallets;
      onAfterRender = params.onAfterRender;
      onEditEntry = params.onEditEntry || null;
      onDeleteEntry = params.onDeleteEntry || null;
      if (params.limits) limits = params.limits;

      if (refs.logEditToggle) {
        refs.logEditToggle.addEventListener("change", () => {
          if (historyMode !== "log") return;
          if (refs.logEditGroup) {
            refs.logEditGroup.style.display = editingEnabled() ? "block" : "none";
          }
          window.dbWalletHistoryUI.render();
        });
      }

      refs.btnModeDiagram.addEventListener("click", () =>
        setHistoryMode("diagram"),
      );
      refs.btnModeLog.addEventListener("click", () => setHistoryMode("log"));
      refs.btnModeRaw.addEventListener("click", () => setHistoryMode("raw"));

      refs.btnRawCurrent.addEventListener("click", () =>
        setRawScope("current"),
      );
      refs.btnRawAll.addEventListener("click", () => setRawScope("all"));

      // Initial call to set UI state
      setHistoryMode(historyMode);
    },
    render() {
      const summary = getSummary();
      const wallet = getWallet();

      if (historyMode === "diagram") {
        if (!summary.perDay.length) {
          refs.elHistory.textContent = "Noch keine Drinks geloggt. ✨";
        } else {
          const lines = formatPerDayDiagram(summary.perDay.slice().reverse());
          refs.elHistory.textContent = lines.join("\n");
        }
      } else if (historyMode === "log") {
        if (refs.elHistoryList) renderList(summary);
      } else if (historyMode === "raw") {
        if (rawScope === "current") {
          if (!rawCurrentCache) {
            rawCurrentCache = JSON.stringify(wallet, null, 2);
          }
          refs.elHistory.textContent = rawCurrentCache;
        } else {
          if (!rawAllCache) {
            rawAllCache = JSON.stringify(getAllWallets(), null, 2);
          }
          refs.elHistory.textContent = rawAllCache;
        }
      }
      if (onAfterRender) {
        onAfterRender();
      }
    },
    invalidateCache() {
      rawAllCache = null;
      rawCurrentCache = null;
    },
  };
})();
