(function () {
  const helpers = window.dbWalletHelpers || null;
  if (
    !helpers ||
    typeof helpers.base64UrlEncode !== "function" ||
    typeof helpers.base64UrlDecode !== "function" ||
    typeof helpers.safeParse !== "function" ||
    typeof helpers.randomToken !== "function"
  ) {
    return;
  }
  const SOFT_LIMIT = 6;
  const HARD_LIMIT = 10;

  const { base64UrlEncode, base64UrlDecode, safeParse, randomToken } = helpers;

  function normalizeAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.round(n));
  }

  function normalizeType(value) {
    const t = typeof value === "string" ? value.trim() : "";
    return t === "d" ? "d" : "g";
  }

  function normalizeScope(value) {
    return value === "global" ? "global" : "local";
  }

  const GLOBAL_ACTION_VERSION = 1;
  const GLOBAL_ACTION_MAX_AMOUNT = 100;

  function clampGlobalAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    const clamped = Math.min(GLOBAL_ACTION_MAX_AMOUNT, Math.max(1, rounded));
    return clamped;
  }

  function normalizeGlobalAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (typeof value === "number" && rounded !== n) return null;
    if (rounded < 1 || rounded > GLOBAL_ACTION_MAX_AMOUNT) return null;
    return rounded;
  }

  function normalizeGlobalPayload(input) {
    if (!input || typeof input !== "object") return null;
    const vRaw = typeof input.v === "number" ? Math.floor(input.v) : null;
    const v =
      vRaw === null || !Number.isFinite(vRaw) ? GLOBAL_ACTION_VERSION : vRaw;
    if (v !== GLOBAL_ACTION_VERSION) return null;
    const t = input.t === "d" || input.t === "g" ? input.t : "";
    if (!t) return null;
    const n = normalizeGlobalAmount(input.n);
    if (n === null) return null;
    const label =
      typeof input.l === "string" && input.l.trim() !== ""
        ? input.l.trim()
        : "";
    const out = { v, t, n };
    if (label) out.l = label;
    return out;
  }

  function defaultLabelForType(type, amount) {
    const amountValue = normalizeAmount(amount);
    const normalizedType = normalizeType(type);
    return normalizedType === "d"
      ? `Drink +${amountValue}`
      : `Guthaben +${amountValue}`;
  }

  function amountPromptForType(type) {
    return normalizeType(type) === "d"
      ? "Wie viele Getränke soll der neue Code trinken?"
      : "Wie viele Getränke soll der neue Code gutschreiben?";
  }

  function rotateActionCodeKey(code, now = Date.now()) {
    if (!code || typeof code !== "object") return;
    code.key = randomToken(18);
    code.updatedAt = now;
    if (!code.createdAt) code.createdAt = code.updatedAt;
  }

  function buildActionCode(data, now = Date.now()) {
    const type = normalizeType(data && data.type);
    const amount = normalizeAmount(data && data.amount);
    const labelRaw = data && typeof data.label === "string" ? data.label : "";
    const label =
      String(labelRaw || "").trim() || defaultLabelForType(type, amount);
    return {
      id: randomToken(10),
      label,
      amount,
      type,
      key: randomToken(18),
      createdAt: now,
      updatedAt: now,
    };
  }

  function buildGlobalCode(data, now = Date.now()) {
    const type = normalizeType(data && data.type);
    const amountRaw = clampGlobalAmount(data && data.amount);
    const amount = amountRaw === null ? 1 : amountRaw;
    const labelRaw = data && typeof data.label === "string" ? data.label : "";
    const label =
      String(labelRaw || "").trim() || defaultLabelForType(type, amount);
    return {
      id: `global:${randomToken(10)}`,
      label,
      amount,
      type,
      scope: "global",
      createdAt: now,
      updatedAt: now,
    };
  }

  function applyActionCodeEdits(code, updates, now = Date.now()) {
    if (!code || typeof code !== "object") return false;
    const nextAmount = normalizeAmount(updates && updates.amount);
    const nextType = normalizeType(updates && updates.type);
    const nextLabelRaw =
      updates && typeof updates.label === "string" ? updates.label : "";
    const nextLabel = String(nextLabelRaw || "").trim() || `+${nextAmount}`;
    const prevLabel = code.label || "";
    const changed =
      nextAmount !== code.amount ||
      nextType !== code.type ||
      nextLabel !== prevLabel;
    code.amount = nextAmount;
    code.type = nextType;
    code.label = nextLabel;
    if (changed) {
      rotateActionCodeKey(code, now);
    } else {
      code.updatedAt = now;
      if (!code.createdAt) code.createdAt = code.updatedAt;
    }
    return true;
  }

  function normalizeActionCode(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const amount = normalizeAmount(raw.amount);
    const type = normalizeType(raw.type);
    const key =
      typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : "";
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : 0;
    const updatedAt =
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : 0;
    return {
      id,
      label,
      amount,
      type,
      key,
      createdAt,
      updatedAt,
    };
  }

  function compareActionCodes(a, b) {
    const au = a && typeof a.updatedAt === "number" ? a.updatedAt : 0;
    const bu = b && typeof b.updatedAt === "number" ? b.updatedAt : 0;
    if (au !== bu) return bu - au;
    const ac = a && typeof a.createdAt === "number" ? a.createdAt : 0;
    const bc = b && typeof b.createdAt === "number" ? b.createdAt : 0;
    if (ac !== bc) return bc - ac;
    const aid = a && typeof a.id === "string" ? a.id : "";
    const bid = b && typeof b.id === "string" ? b.id : "";
    return aid.localeCompare(bid);
  }

  function normalizeActionCodes(list, now = Date.now()) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    const seen = new Set();

    for (const raw of arr) {
      const code = normalizeActionCode(raw);
      if (!code) continue;

      if (!code.id) code.id = randomToken(10);
      if (!code.key) code.key = randomToken(18);
      if (!code.updatedAt && !code.createdAt) {
        code.updatedAt = now;
        code.createdAt = now;
      } else if (!code.updatedAt) {
        code.updatedAt = code.createdAt;
      } else if (!code.createdAt) {
        code.createdAt = code.updatedAt;
      }
      if (!code.label) {
        const typeLabel = code.type === "d" ? "Drink" : "Guthaben";
        code.label = `${typeLabel} +${code.amount}`;
      }

      let id = code.id;
      while (seen.has(id)) {
        id = randomToken(10);
      }
      code.id = id;
      seen.add(id);
      out.push(code);
    }

    out.sort(compareActionCodes);
    const trimmedCount = Math.max(0, out.length - HARD_LIMIT);
    const trimmed = out.slice(0, HARD_LIMIT);
    if (trimmedCount > 0) {
      trimmed._dbwTrimmed = trimmedCount;
    }
    return trimmed;
  }

  function mergeActionCodes(localList, remoteList) {
    const now = Date.now();
    const local = normalizeActionCodes(localList, now);
    const remote = normalizeActionCodes(remoteList, now);

    const byId = new Map();
    for (const c of local) byId.set(c.id, c);

    for (const c of remote) {
      const existing = byId.get(c.id);
      if (!existing) {
        local.push(c);
        byId.set(c.id, c);
        continue;
      }
      const localUpdated = existing.updatedAt || 0;
      const remoteUpdated = c.updatedAt || 0;
      if (remoteUpdated >= localUpdated) {
        existing.label = c.label;
        existing.amount = c.amount;
        existing.type = c.type;
        existing.key = c.key;
        existing.createdAt = c.createdAt;
        existing.updatedAt = c.updatedAt;
      }
    }
    const merged = normalizeActionCodes(local, now);
    const remoteTrimmed =
      remote && typeof remote._dbwTrimmed === "number" ? remote._dbwTrimmed : 0;
    const mergedTrimmed =
      merged && typeof merged._dbwTrimmed === "number" ? merged._dbwTrimmed : 0;
    if (remoteTrimmed > 0 || mergedTrimmed > 0) {
      merged._dbwTrimmed = Math.max(remoteTrimmed, mergedTrimmed);
    }
    return merged;
  }

  function buildActionPayload(wallet, code) {
    const payload = {
      v: 2,
      walletId:
        wallet && typeof wallet.walletId === "string" ? wallet.walletId : "",
      codeId: code.id,
      key: code.key,
    };
    return payload;
  }

  function encodeGlobalActionHash(input) {
    const payload = normalizeGlobalPayload(input);
    if (!payload) return "";
    const json = JSON.stringify(payload);
    return "acg:" + base64UrlEncode(json);
  }

  function decodeGlobalActionHash(hash) {
    const raw = String(hash || "");
    if (!raw.startsWith("acg:")) return null;
    const token = raw.slice(4);
    if (!token) return null;
    try {
      const json = base64UrlDecode(token);
      const payload = safeParse(json);
      return normalizeGlobalPayload(payload);
    } catch (e) {
      return null;
    }
  }

  function encodeActionHash(payload) {
    const json = JSON.stringify(payload || {});
    return "ac:" + base64UrlEncode(json);
  }

  function decodeActionHash(hash) {
    const raw = String(hash || "");
    if (!raw.startsWith("ac:")) return null;
    const token = raw.slice(3);
    if (!token) return null;
    const json = base64UrlDecode(token);
    const payload = safeParse(json);
    if (!payload || typeof payload !== "object") return null;
    const walletId =
      typeof payload.walletId === "string" ? payload.walletId : "";
    const codeId = typeof payload.codeId === "string" ? payload.codeId : "";
    const key = typeof payload.key === "string" ? payload.key : "";
    const v =
      typeof payload.v === "number" && Number.isFinite(payload.v)
        ? payload.v
        : 1;
    const out = { v, walletId, codeId, key };
    const type = typeof payload.type === "string" ? payload.type.trim() : "";
    if (type === "d" || type === "g") out.type = type;
    return out;
  }

  function canvasToPngDownload(canvas, filename) {
    if (!canvas) return;
    const saveBlob = (blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
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
    if (!window.qrcodegen || !window.qrcodegen.QrCode) {
      throw new Error("QR library missing");
    }

    const ecc = window.qrcodegen.QrCode.Ecc.LOW;
    const qr = window.qrcodegen.QrCode.encodeText(String(url || ""), ecc);
    const border = 4;
    const scale = 6;
    const size = qr.size;
    const dim = (size + border * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.getModule(x, y)) {
          ctx.fillRect(
            (x + border) * scale,
            (y + border) * scale,
            scale,
            scale,
          );
        }
      }
    }
  }

  function ensureWalletActionCodes(wallet) {
    if (!wallet || typeof wallet !== "object") return false;
    const now = Date.now();
    const current = Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];
    const normalized = normalizeActionCodes(current, now);
    const prevTrimmed =
      typeof current._dbwTrimmed === "number" ? current._dbwTrimmed : 0;
    const nextTrimmed =
      typeof normalized._dbwTrimmed === "number" ? normalized._dbwTrimmed : 0;
    const trimmedCount = Math.max(prevTrimmed, nextTrimmed);
    if (trimmedCount > 0) {
      normalized._dbwTrimmed = trimmedCount;
    }
    const changed = JSON.stringify(current) !== JSON.stringify(normalized);
    wallet.actionCodes = normalized;
    return {
      changed,
      trimmedCount,
    };
  }

  function initActionCodesUi(options) {
    const container = options && options.container;
    const getWallet =
      options && typeof options.getWallet === "function"
        ? options.getWallet
        : () => null;
    const persistWallet =
      options && typeof options.persistWallet === "function"
        ? options.persistWallet
        : () => {};
    const getBaseUrl =
      options && typeof options.getBaseUrl === "function"
        ? options.getBaseUrl
        : () => String(window.location.href || "").split("#")[0];

    if (!container) return { refresh: () => {} };
    let showTrimNotice = false;
    let showSoftLimitNotice = false;
    let selectedType = "d";
    let selectedScope = "local";
    let createOpen = false;
    let editingId = "";
    let pendingDeleteId = "";
    let globalCodes = [];

    function persistIfChanged(wallet) {
      const current = Array.isArray(wallet && wallet.actionCodes)
        ? wallet.actionCodes
        : [];
      if (current.length > HARD_LIMIT) showTrimNotice = true;
      const res = ensureWalletActionCodes(wallet);
      if (res && res.trimmedCount > 0) showTrimNotice = true;
      if (res && res.changed) persistWallet(wallet);
    }

    function actionUrlFor(code) {
      const wallet = getWallet();
      const scope = normalizeScope(code && code.scope);
      if (scope === "global") {
        const label =
          code && typeof code.label === "string" ? code.label.trim() : "";
        const amountRaw = clampGlobalAmount(code && code.amount);
        const amount = amountRaw === null ? 1 : amountRaw;
        const payload = {
          v: GLOBAL_ACTION_VERSION,
          t: normalizeType(code && code.type),
          n: amount,
        };
        if (label) payload.l = label;
        const hash = encodeGlobalActionHash(payload);
        return hash ? getBaseUrl() + "#" + hash : "";
      }
      const payload = buildActionPayload(wallet, code);
      return getBaseUrl() + "#" + encodeActionHash(payload);
    }

    function buildTypeToggle(initialType, onChange) {
      let currentType = normalizeType(initialType);
      const wrapper = document.createElement("div");
      wrapper.className = "action-code-type-toggle";

      const btnTypeDrink = document.createElement("button");
      btnTypeDrink.type = "button";
      btnTypeDrink.textContent = "🥤 Trinken";
      btnTypeDrink.className = "mode-btn";
      btnTypeDrink.setAttribute("aria-pressed", "false");

      const btnTypeCredit = document.createElement("button");
      btnTypeCredit.type = "button";
      btnTypeCredit.textContent = "💰 Guthaben";
      btnTypeCredit.className = "mode-btn";
      btnTypeCredit.setAttribute("aria-pressed", "false");

      function sync() {
        currentType = currentType === "g" ? "g" : "d";
        const isDrink = currentType === "d";
        btnTypeDrink.classList.toggle("active", isDrink);
        btnTypeCredit.classList.toggle("active", !isDrink);
        btnTypeDrink.setAttribute("aria-pressed", isDrink ? "true" : "false");
        btnTypeCredit.setAttribute("aria-pressed", isDrink ? "false" : "true");
      }

      btnTypeDrink.addEventListener("click", () => {
        currentType = "d";
        sync();
        if (onChange) onChange(currentType);
      });
      btnTypeCredit.addEventListener("click", () => {
        currentType = "g";
        sync();
        if (onChange) onChange(currentType);
      });

      sync();
      wrapper.appendChild(btnTypeDrink);
      wrapper.appendChild(btnTypeCredit);

      return {
        el: wrapper,
        getType: () => currentType,
        setType: (type) => {
          currentType = normalizeType(type);
          sync();
        },
      };
    }

    function buildScopeToggle(initialScope, onChange) {
      let currentScope = normalizeScope(initialScope);
      const wrapper = document.createElement("div");
      wrapper.className = "action-code-scope-toggle";

      const btnLocal = document.createElement("button");
      btnLocal.type = "button";
      btnLocal.textContent = "🔒 Lokal";
      btnLocal.className = "mode-btn";
      btnLocal.setAttribute("aria-pressed", "false");

      const btnGlobal = document.createElement("button");
      btnGlobal.type = "button";
      btnGlobal.textContent = "🌍 Global";
      btnGlobal.className = "mode-btn";
      btnGlobal.setAttribute("aria-pressed", "false");

      function sync() {
        currentScope = normalizeScope(currentScope);
        const isLocal = currentScope === "local";
        btnLocal.classList.toggle("active", isLocal);
        btnGlobal.classList.toggle("active", !isLocal);
        btnLocal.setAttribute("aria-pressed", isLocal ? "true" : "false");
        btnGlobal.setAttribute("aria-pressed", isLocal ? "false" : "true");
      }

      btnLocal.addEventListener("click", () => {
        currentScope = "local";
        sync();
        if (onChange) onChange(currentScope);
      });
      btnGlobal.addEventListener("click", () => {
        currentScope = "global";
        sync();
        if (onChange) onChange(currentScope);
      });

      sync();
      wrapper.appendChild(btnLocal);
      wrapper.appendChild(btnGlobal);

      return {
        el: wrapper,
        getScope: () => currentScope,
        setScope: (scope) => {
          currentScope = normalizeScope(scope);
          sync();
        },
      };
    }

    function refresh() {
      const wallet = getWallet();
      if (!wallet) return;

      persistIfChanged(wallet);

      const localCodes = Array.isArray(wallet.actionCodes)
        ? wallet.actionCodes
        : [];
      const codes = localCodes.concat(globalCodes);
      if (localCodes.length < SOFT_LIMIT) showSoftLimitNotice = false;
      if (editingId && !codes.find((c) => c && c.id === editingId)) {
        editingId = "";
      }
      if (
        pendingDeleteId &&
        !codes.find((c) => c && c.id === pendingDeleteId)
      ) {
        pendingDeleteId = "";
      }

      container.innerHTML = "";
      container.classList.add("action-codes-body-inner");

      const toolbar = document.createElement("div");
      toolbar.className = "action-codes-toolbar";

      const btnAdd = document.createElement("button");
      btnAdd.type = "button";
      btnAdd.textContent = "New action code";
      btnAdd.addEventListener("click", () => {
        const walletNow = getWallet();
        if (!walletNow) return;
        persistIfChanged(walletNow);
        const currentCodes = Array.isArray(walletNow.actionCodes)
          ? walletNow.actionCodes
          : [];
        if (currentCodes.length >= SOFT_LIMIT) {
          showSoftLimitNotice = true;
        }
        createOpen = !createOpen;
        editingId = "";
        pendingDeleteId = "";
        refresh();
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

      const createForm = document.createElement("div");
      createForm.className = "action-code-form";

      if (createOpen) {
        const scopeToggle = buildScopeToggle(selectedScope, (nextScope) => {
          selectedScope = nextScope;
          updateCreateAmountLimit();
        });
        const typeToggle = buildTypeToggle(selectedType, (nextType) => {
          selectedType = nextType;
          updateCreateDefaults();
          updateCreateAmountLabel();
        });

        const amountInput = document.createElement("input");
        amountInput.type = "number";
        amountInput.min = "1";
        amountInput.value = "10";

        const labelInput = document.createElement("input");
        labelInput.type = "text";

        let autoLabel = defaultLabelForType(selectedType, amountInput.value);
        labelInput.value = autoLabel;

        function updateCreateDefaults() {
          const nextDefault = defaultLabelForType(
            typeToggle.getType(),
            amountInput.value,
          );
          const current = labelInput.value.trim();
          if (!current || current === autoLabel) {
            labelInput.value = nextDefault;
          }
          autoLabel = nextDefault;
        }

        function updateCreateAmountLabel() {
          amountText.textContent = amountPromptForType(typeToggle.getType());
        }

        function updateCreateAmountLimit() {
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
          updateCreateDefaults();
          updateCreateAmountLimit();
        });

        const labelField = document.createElement("label");
        labelField.className = "action-code-form-field";
        const labelText = document.createElement("span");
        labelText.textContent = "Name für den Action Code:";
        labelField.appendChild(labelText);
        labelField.appendChild(labelInput);

        const amountField = document.createElement("label");
        amountField.className = "action-code-form-field";
        const amountText = document.createElement("span");
        amountText.textContent = amountPromptForType(selectedType);
        amountField.appendChild(amountText);
        amountField.appendChild(amountInput);

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
          const walletNow = getWallet();
          if (!walletNow) return;
          const scope = scopeToggle.getScope();
          if (scope === "global") {
            const created = buildGlobalCode({
              type: typeToggle.getType(),
              amount: amountInput.value,
              label: labelInput.value,
            });
            globalCodes.push(created);
          } else {
            persistIfChanged(walletNow);
            const currentCodes = Array.isArray(walletNow.actionCodes)
              ? walletNow.actionCodes
              : [];
            const hadNoCodes = currentCodes.length === 0;
            const created = buildActionCode({
              type: typeToggle.getType(),
              amount: amountInput.value,
              label: labelInput.value,
            });
            if (!Array.isArray(walletNow.actionCodes))
              walletNow.actionCodes = [];
            walletNow.actionCodes.push(created);
            const res = ensureWalletActionCodes(walletNow);
            if (res && res.trimmedCount > 0) showTrimNotice = true;
            persistWallet(walletNow);
            if (hadNoCodes) {
              const details =
                typeof container.closest === "function"
                  ? container.closest("details")
                  : null;
              if (details) details.open = true;
            }
          }
          createOpen = false;
          refresh();
        });

        const btnCancel = document.createElement("button");
        btnCancel.type = "button";
        btnCancel.textContent = "Abbrechen";
        btnCancel.addEventListener("click", () => {
          createOpen = false;
          refresh();
        });

        actions.appendChild(btnSave);
        actions.appendChild(btnCancel);

        updateCreateAmountLimit();
        createForm.appendChild(scopeToggle.el);
        createForm.appendChild(typeToggle.el);
        createForm.appendChild(fields);
        createForm.appendChild(actions);
      }

      const grid = document.createElement("div");
      grid.className = "action-codes-grid";

      if (!codes.length) {
        const empty = document.createElement("div");
        empty.className = "action-codes-empty";
        empty.textContent =
          "Noch keine Action Codes – klicke auf “New action code”.";
        container.appendChild(toolbar);
        container.appendChild(hint);
        if (showSoftLimitNotice) {
          container.appendChild(softNotice);
          showSoftLimitNotice = false;
        }
        if (showTrimNotice) container.appendChild(notice);
        if (createOpen) container.appendChild(createForm);
        container.appendChild(empty);
        return;
      }

      if (codes.length === 1) {
        grid.classList.add("action-codes-grid--single");
      }

      for (const code of codes) {
        const isGlobal = normalizeScope(code && code.scope) === "global";
        const card = document.createElement("div");
        card.className = "action-code-card";
        if (codes.length === 1) {
          card.classList.add("action-code-card--featured");
        }

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
          editingId = code.id;
          pendingDeleteId = "";
          createOpen = false;
          refresh();
        });

        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.textContent = "Löschen";
        btnDelete.addEventListener("click", () => {
          pendingDeleteId = pendingDeleteId === code.id ? "" : code.id;
          editingId = "";
          createOpen = false;
          refresh();
        });

        btns.appendChild(btnEdit);
        btns.appendChild(btnDelete);

        head.appendChild(meta);
        head.appendChild(btns);

        if (editingId === code.id) {
          const editForm = document.createElement("div");
          editForm.className = "action-code-form";

          const scopeToggle = buildScopeToggle(
            isGlobal ? "global" : "local",
            () => {
              updateEditAmountLimit();
            },
          );
          const typeToggle = buildTypeToggle(code.type, (nextType) => {
            amountLabel.textContent = amountPromptForType(nextType);
          });

          const amountInput = document.createElement("input");
          amountInput.type = "number";
          amountInput.min = "1";
          amountInput.value = String(code.amount || 1);
          amountInput.addEventListener("input", () => {
            updateEditAmountLimit();
          });

          const labelInput = document.createElement("input");
          labelInput.type = "text";
          labelInput.value =
            code.label ||
            defaultLabelForType(code.type, normalizeAmount(code.amount));

          const amountField = document.createElement("label");
          amountField.className = "action-code-form-field";
          const amountLabel = document.createElement("span");
          amountLabel.textContent = amountPromptForType(code.type);
          amountField.appendChild(amountLabel);
          amountField.appendChild(amountInput);

          const labelField = document.createElement("label");
          labelField.className = "action-code-form-field";
          const labelText = document.createElement("span");
          labelText.textContent = "Name für den Action Code:";
          labelField.appendChild(labelText);
          labelField.appendChild(labelInput);

          const fields = document.createElement("div");
          fields.className = "action-code-form-fields";
          fields.appendChild(amountField);
          fields.appendChild(labelField);

          const actions = document.createElement("div");
          actions.className = "action-code-form-actions";

          function updateEditAmountLimit() {
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

          const btnSave = document.createElement("button");
          btnSave.type = "button";
          btnSave.textContent = "Speichern";
          btnSave.addEventListener("click", () => {
            const walletNow = getWallet();
            if (!walletNow) return;
            const scope = scopeToggle.getScope();
            if (scope === "global") {
              if (!isGlobal) {
                const codesNow = Array.isArray(walletNow.actionCodes)
                  ? walletNow.actionCodes
                  : [];
                walletNow.actionCodes = codesNow.filter(
                  (c) => c && c.id !== code.id,
                );
                const res = ensureWalletActionCodes(walletNow);
                if (res && res.trimmedCount > 0) showTrimNotice = true;
                persistWallet(walletNow);
                const created = buildGlobalCode({
                  type: typeToggle.getType(),
                  amount: amountInput.value,
                  label: labelInput.value,
                });
                globalCodes.push(created);
              } else {
                code.type = normalizeType(typeToggle.getType());
                const amountRaw = clampGlobalAmount(amountInput.value);
                code.amount = amountRaw === null ? 1 : amountRaw;
                const labelRaw = String(labelInput.value || "").trim();
                code.label =
                  labelRaw || defaultLabelForType(code.type, code.amount);
                code.updatedAt = Date.now();
              }
            } else {
              if (isGlobal) {
                globalCodes = globalCodes.filter((c) => c.id !== code.id);
                const created = buildActionCode({
                  type: typeToggle.getType(),
                  amount: amountInput.value,
                  label: labelInput.value,
                });
                if (!Array.isArray(walletNow.actionCodes))
                  walletNow.actionCodes = [];
                walletNow.actionCodes.push(created);
              } else {
                const codesNow = Array.isArray(walletNow.actionCodes)
                  ? walletNow.actionCodes
                  : [];
                const target = codesNow.find((c) => c && c.id === code.id);
                if (!target) return;
                applyActionCodeEdits(target, {
                  label: labelInput.value,
                  amount: amountInput.value,
                  type: typeToggle.getType(),
                });
              }
              const res = ensureWalletActionCodes(walletNow);
              if (res && res.trimmedCount > 0) showTrimNotice = true;
              persistWallet(walletNow);
            }
            editingId = "";
            refresh();
          });

          const btnCancel = document.createElement("button");
          btnCancel.type = "button";
          btnCancel.textContent = "Abbrechen";
          btnCancel.addEventListener("click", () => {
            editingId = "";
            refresh();
          });

          actions.appendChild(btnSave);
          actions.appendChild(btnCancel);

          updateEditAmountLimit();
          editForm.appendChild(scopeToggle.el);
          editForm.appendChild(typeToggle.el);
          editForm.appendChild(fields);
          editForm.appendChild(actions);

          card.appendChild(head);
          card.appendChild(editForm);
        } else if (pendingDeleteId === code.id) {
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
            const walletNow = getWallet();
            if (!walletNow) return;
            if (isGlobal) {
              globalCodes = globalCodes.filter((c) => c.id !== code.id);
            } else {
              const codesNow = Array.isArray(walletNow.actionCodes)
                ? walletNow.actionCodes
                : [];
              walletNow.actionCodes = codesNow.filter(
                (c) => c && c.id !== code.id,
              );
              const res = ensureWalletActionCodes(walletNow);
              if (res && res.trimmedCount > 0) showTrimNotice = true;
              persistWallet(walletNow);
            }
            pendingDeleteId = "";
            refresh();
          });

          const btnCancel = document.createElement("button");
          btnCancel.type = "button";
          btnCancel.textContent = "Abbrechen";
          btnCancel.addEventListener("click", () => {
            pendingDeleteId = "";
            refresh();
          });

          deleteActions.appendChild(btnConfirm);
          deleteActions.appendChild(btnCancel);

          deleteBox.appendChild(deleteText);
          deleteBox.appendChild(deleteActions);

          card.appendChild(head);
          card.appendChild(deleteBox);
        } else {
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
            url = actionUrlFor(code);
            urlInput.value = url;
            renderQrToCanvas(canvas, url);
          } catch (e) {
            urlInput.value = "";
            const msg = String(e && e.message ? e.message : e || "");
            const fallback = document.createElement("div");
            fallback.className = "action-code-error";
            fallback.textContent = msg.includes("QR library missing")
              ? "QR-Code-Generator fehlt (qrcodegen.js)."
              : "QR-Code konnte nicht erzeugt werden.";
            card.appendChild(head);
            card.appendChild(fallback);
            grid.appendChild(card);
            continue;
          }

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

          canvas.addEventListener("click", () => {
            if (!url) return;
            const safeUserId = String(wallet.userId || "user").replace(
              /[^a-zA-Z0-9_-]/g,
              "_",
            );
            const safeCode = String(code.label || `+${code.amount}`)
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 20);
            const filename = `db-wallet-${safeUserId}-action-${safeCode}.png`;
            canvasToPngDownload(canvas, filename);
          });

          card.appendChild(head);
          card.appendChild(canvas);
          card.appendChild(urlInput);
        }

        grid.appendChild(card);
      }

      container.appendChild(toolbar);
      container.appendChild(hint);
      if (showSoftLimitNotice) {
        container.appendChild(softNotice);
        showSoftLimitNotice = false;
      }
      if (showTrimNotice) container.appendChild(notice);
      if (createOpen) container.appendChild(createForm);
      container.appendChild(grid);
    }

    refresh();
    return { refresh };
  }

  window.dbWalletActionCodes = {
    mergeActionCodes,
    normalizeActionCodes,
    buildActionCode,
    applyActionCodeEdits,
    buildActionPayload,
    encodeGlobalActionHash,
    decodeGlobalActionHash,
    decodeActionHash,
    encodeActionHash,
    initActionCodesUi,
    ensureWalletActionCodes,
    normalizeAmount,
    defaultLabelForType,
    HARD_LIMIT,
    SOFT_LIMIT,
    GLOBAL_ACTION_MAX_AMOUNT,
  };
})();
