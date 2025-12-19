(function () {
  const helpers = window.dbWalletHelpers || null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const SOFT_LIMIT = 6;
  const HARD_LIMIT = 10;

  function safeParseFallback(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  const safeParse =
    helpers && typeof helpers.safeParse === "function"
      ? helpers.safeParse
      : safeParseFallback;

  function base64UrlFromBinary(binary) {
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function base64UrlEncode(str) {
    const bytes = encoder.encode(String(str || ""));
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return base64UrlFromBinary(binary);
  }

  function base64UrlDecode(str) {
    const input = String(str || "");
    const padLen = (4 - (input.length % 4)) % 4;
    const padded = input + "=".repeat(padLen);
    const base = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decoder.decode(bytes);
  }

  function randomTokenFallback(len = 18) {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    try {
      if (
        typeof crypto !== "undefined" &&
        crypto &&
        typeof crypto.getRandomValues === "function"
      ) {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
          out += chars[bytes[i] % chars.length];
        }
        return out;
      }
    } catch (e) {
      // ignore
    }

    let out = "";
    for (let i = 0; i < len; i++) {
      out += chars[(Math.random() * chars.length) | 0];
    }
    return out;
  }

  const randomToken =
    helpers && typeof helpers.randomToken === "function"
      ? helpers.randomToken
      : randomTokenFallback;

  function normalizeAmount(value) {
    const n = typeof value === "number" ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.round(n));
  }

  function normalizeType(value) {
    const t = typeof value === "string" ? value.trim() : "";
    return t === "d" ? "d" : "g";
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
      v: 1,
      walletId:
        wallet && typeof wallet.walletId === "string" ? wallet.walletId : "",
      codeId: code.id,
      key: code.key,
    };
    const type = code && typeof code.type === "string" ? code.type : "";
    if (type === "d" || type === "g") payload.type = type;
    return payload;
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
    let selectedType = "d";

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
      const payload = buildActionPayload(wallet, code);
      return getBaseUrl() + "#" + encodeActionHash(payload);
    }

    function rotateKey(code) {
      code.key = randomToken(18);
      code.updatedAt = Date.now();
      if (!code.createdAt) code.createdAt = code.updatedAt;
    }

    function editCode(code) {
      const currentLabel =
        code.label ||
        `${code.type === "d" ? "Drink" : "Guthaben"} +${code.amount}`;
      const newLabelRaw = prompt("Name für den Action Code:", currentLabel);
      if (newLabelRaw === null) return false;

      const amountPrompt =
        code.type === "d"
          ? "Wie viele Getränke soll dieser Code als Trinken buchen?"
          : "Wie viele Getränke soll dieser Code gutschreiben?";
      const newAmountRaw = prompt(amountPrompt, String(code.amount || 1));
      if (newAmountRaw === null) return false;

      const nextAmount = normalizeAmount(newAmountRaw);
      const nextLabel = String(newLabelRaw || "").trim() || `+${nextAmount}`;

      const changed =
        nextAmount !== code.amount || nextLabel !== (code.label || "");
      code.amount = nextAmount;
      code.label = nextLabel;
      if (changed) {
        rotateKey(code);
      } else {
        code.updatedAt = Date.now();
      }
      if (!code.createdAt) code.createdAt = code.updatedAt;
      return true;
    }

    function createCode(typeHint) {
      const type = typeHint === "g" ? "g" : "d";
      const amountRaw = prompt(
        "Wie viele Getränke soll der neue Code gutschreiben?",
        "10",
      );
      if (amountRaw === null) return null;
      const amount = normalizeAmount(amountRaw);
      const defaultLabel =
        type === "g" ? `Guthaben +${amount}` : `Drink +${amount}`;
      const labelRaw = prompt("Name für den Action Code:", defaultLabel);
      if (labelRaw === null) return null;
      const label = String(labelRaw || "").trim() || defaultLabel;
      const now = Date.now();
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

    function refresh() {
      const wallet = getWallet();
      if (!wallet) return;

      persistIfChanged(wallet);

      container.innerHTML = "";
      container.classList.add("action-codes-body-inner");

      const toolbar = document.createElement("div");
      toolbar.className = "action-codes-toolbar";
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

      const btnAdd = document.createElement("button");
      btnAdd.type = "button";
      btnAdd.textContent = "+ Code";
      btnAdd.addEventListener("click", () => {
        const walletNow = getWallet();
        if (!walletNow) return;
        persistIfChanged(walletNow);
        const currentCodes = Array.isArray(walletNow.actionCodes)
          ? walletNow.actionCodes
          : [];
        const hadNoCodes = currentCodes.length === 0;
        if (currentCodes.length >= SOFT_LIMIT) {
          alert(
            "Empfohlen: max. 6 Action Codes. Ab 10 werden automatisch nur die 10 zuletzt aktiven gespeichert (ältere werden entfernt).",
          );
        }
        const created = createCode(selectedType);
        if (!created) return;
        if (!Array.isArray(walletNow.actionCodes)) walletNow.actionCodes = [];
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
        refresh();
      });

      function syncTypeButtons() {
        selectedType = selectedType === "g" ? "g" : "d";
        const isDrink = selectedType === "d";
        btnTypeDrink.classList.toggle("active", isDrink);
        btnTypeCredit.classList.toggle("active", !isDrink);
        btnTypeDrink.setAttribute("aria-pressed", isDrink ? "true" : "false");
        btnTypeCredit.setAttribute("aria-pressed", isDrink ? "false" : "true");
      }
      btnTypeDrink.addEventListener("click", () => {
        selectedType = "d";
        syncTypeButtons();
      });
      btnTypeCredit.addEventListener("click", () => {
        selectedType = "g";
        syncTypeButtons();
      });
      syncTypeButtons();

      toolbar.appendChild(btnTypeDrink);
      toolbar.appendChild(btnTypeCredit);
      toolbar.appendChild(btnAdd);

      const hint = document.createElement("div");
      hint.className = "action-codes-hint";
      hint.textContent =
        "Diese QR-Codes buchen Drinks oder Guthaben auf dieses Wallet. Nach Änderungen bitte neu scannen/ausdrucken.";

      const notice = document.createElement("div");
      notice.className = "action-codes-notice";
      notice.textContent =
        "Hinweis: Für Import/Export werden nur die 10 zuletzt aktiven Action Codes gespeichert. Ältere Codes wurden entfernt.";

      const grid = document.createElement("div");
      grid.className = "action-codes-grid";

      const codes = Array.isArray(wallet.actionCodes) ? wallet.actionCodes : [];

      if (!codes.length) {
        const empty = document.createElement("div");
        empty.className = "action-codes-empty";
        empty.textContent = "Noch keine Action Codes – klicke auf “+ Code”.";
        container.appendChild(toolbar);
        if (showTrimNotice) container.appendChild(notice);
        container.appendChild(hint);
        container.appendChild(empty);
        return;
      }

      if (codes.length === 1) {
        grid.classList.add("action-codes-grid--single");
      }

      for (const code of codes) {
        const card = document.createElement("div");
        card.className = "action-code-card";
        if (codes.length === 1) {
          card.classList.add("action-code-card--featured");
        }

        const head = document.createElement("div");
        head.className = "action-code-head";

        const meta = document.createElement("div");
        meta.className = "action-code-meta";

        const label = document.createElement("div");
        label.className = "action-code-label";
        label.textContent = code.label || `+${code.amount}`;

        const amount = document.createElement("div");
        amount.className = "action-code-amount";
        const typeLabel = code.type === "d" ? "Drink" : "Guthaben";
        amount.textContent = `+${normalizeAmount(code.amount)} Getränke (${typeLabel})`;

        meta.appendChild(label);
        meta.appendChild(amount);

        const btns = document.createElement("div");
        btns.className = "action-code-buttons";

        const btnEdit = document.createElement("button");
        btnEdit.type = "button";
        btnEdit.textContent = "Bearbeiten";
        btnEdit.addEventListener("click", () => {
          const walletNow = getWallet();
          if (!walletNow) return;
          const codesNow = Array.isArray(walletNow.actionCodes)
            ? walletNow.actionCodes
            : [];
          const target = codesNow.find((c) => c && c.id === code.id);
          if (!target) return;
          const changed = editCode(target);
          if (!changed) return;
          const res = ensureWalletActionCodes(walletNow);
          if (res && res.trimmedCount > 0) showTrimNotice = true;
          persistWallet(walletNow);
          refresh();
        });

        const btnRegen = document.createElement("button");
        btnRegen.type = "button";
        btnRegen.textContent = "Neu erzeugen";
        btnRegen.addEventListener("click", () => {
          const walletNow = getWallet();
          if (!walletNow) return;
          const codesNow = Array.isArray(walletNow.actionCodes)
            ? walletNow.actionCodes
            : [];
          const target = codesNow.find((c) => c && c.id === code.id);
          if (!target) return;
          rotateKey(target);
          const res = ensureWalletActionCodes(walletNow);
          if (res && res.trimmedCount > 0) showTrimNotice = true;
          persistWallet(walletNow);
          refresh();
        });

        const btnDelete = document.createElement("button");
        btnDelete.type = "button";
        btnDelete.textContent = "Löschen";
        btnDelete.addEventListener("click", () => {
          if (
            !confirm(
              `Action Code "${code.label || `+${code.amount}`}" löschen?`,
            )
          ) {
            return;
          }
          const walletNow = getWallet();
          if (!walletNow) return;
          const codesNow = Array.isArray(walletNow.actionCodes)
            ? walletNow.actionCodes
            : [];
          walletNow.actionCodes = codesNow.filter((c) => c && c.id !== code.id);
          const res = ensureWalletActionCodes(walletNow);
          if (res && res.trimmedCount > 0) showTrimNotice = true;
          persistWallet(walletNow);
          refresh();
        });

        btns.appendChild(btnEdit);
        btns.appendChild(btnRegen);
        btns.appendChild(btnDelete);

        head.appendChild(meta);
        head.appendChild(btns);

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
        grid.appendChild(card);
      }

      container.appendChild(toolbar);
      container.appendChild(hint);
      if (showTrimNotice) container.appendChild(notice);
      container.appendChild(grid);
    }

    refresh();
    return { refresh };
  }

  window.dbWalletActionCodes = {
    mergeActionCodes,
    normalizeActionCodes,
    decodeActionHash,
    encodeActionHash,
    initActionCodesUi,
    ensureWalletActionCodes,
    normalizeAmount,
    HARD_LIMIT,
    SOFT_LIMIT,
  };
})();
