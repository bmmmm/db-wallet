(function () {
  let opts = null;
  let refs = null;

  let lastQrUrl = "";

  const QR_SESSION_CACHE_PREFIX = "db-wallet:qr-session:";

  function getBaseUrl() {
    const href = String(window.location.href || "");
    const idx = href.indexOf("#");
    return idx >= 0 ? href.slice(0, idx) : href;
  }

  function clearQr() {
    if (refs && refs.qrBox) refs.qrBox.style.display = "none";
    if (refs && refs.qrHint) refs.qrHint.textContent = "";
    if (refs && refs.qrCanvas) {
      const ctx = refs.qrCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, refs.qrCanvas.width, refs.qrCanvas.height);
    }
    if (refs && refs.qrUrl) refs.qrUrl.value = "";
    lastQrUrl = "";
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) {
        sessionStorage.removeItem(qrSessionCacheKey());
      }
    } catch (e) {
      // ignore
    }
  }

  function clear() {
    if (!refs) return;
    refs.elExportUrl.value = "";
    refs.elExportUrl.style.display = "none";
    clearQr();
  }

  function openSection() {
    if (!refs || !refs.btnExport || !refs.exportOptions) return;
    try {
      refs.btnExport.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      // ignore
    }
    if (
      refs.exportOptions.style.display === "none" ||
      refs.exportOptions.style.display === ""
    ) {
      refs.exportOptions.style.display = "inline-block";
    }
  }

  function qrSessionCacheKey() {
    const wallet = opts && opts.getWallet ? opts.getWallet() : null;
    const id =
      wallet && typeof wallet.walletId === "string"
        ? wallet.walletId
        : wallet && typeof wallet.userId === "string"
          ? wallet.userId
          : "unknown";
    return QR_SESSION_CACHE_PREFIX + id;
  }

  function getQrSessionFingerprint() {
    const wallet = opts && opts.getWallet ? opts.getWallet() : null;
    let updated = 0;
    try {
      const reg = opts.loadRegistry ? opts.loadRegistry() : null;
      const entry =
        reg &&
        wallet &&
        typeof wallet.userId === "string" &&
        reg[wallet.userId];
      if (
        entry &&
        typeof entry.lastUpdated === "number" &&
        Number.isFinite(entry.lastUpdated)
      ) {
        updated = entry.lastUpdated;
      }
    } catch (e) {
      // ignore
    }
    const theme = opts.getStoredTheme ? opts.getStoredTheme() || "" : "";
    const walletId = wallet && typeof wallet.walletId === "string" ? wallet.walletId : "";
    const v = wallet && typeof wallet.v === "number" ? wallet.v : 1;
    return `${walletId}|${v}|${updated}|${theme}`;
  }

  function loadCachedQrUrl() {
    try {
      if (typeof sessionStorage === "undefined" || !sessionStorage) return "";
      const raw = sessionStorage.getItem(qrSessionCacheKey());
      if (!raw) return "";
      const obj = opts.safeParse ? opts.safeParse(raw) : null;
      if (!obj || typeof obj !== "object") return "";
      if (obj.f !== getQrSessionFingerprint()) return "";
      return typeof obj.url === "string" ? obj.url : "";
    } catch (e) {
      return "";
    }
  }

  function storeCachedQrUrl(url) {
    if (!url) return;
    try {
      if (typeof sessionStorage === "undefined" || !sessionStorage) return;
      sessionStorage.setItem(
        qrSessionCacheKey(),
        JSON.stringify({ f: getQrSessionFingerprint(), url }),
      );
    } catch (e) {
      // ignore
    }
  }

  function selectQrUrl() {
    if (!refs || !refs.qrUrl || !refs.qrUrl.value) return;
    const el = refs.qrUrl;
    if (document.activeElement !== el) {
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        el.focus();
      }
    }
    el.select();
    try {
      el.setSelectionRange(0, el.value.length);
    } catch (e) {}
  }

  function renderQrCode(url) {
    if (!window.qrcodegen || !window.qrcodegen.QrCode || !refs || !refs.qrCanvas) {
      throw new Error("QR library missing");
    }
    const ecc = window.qrcodegen.QrCode.Ecc.LOW;
    const qr = window.qrcodegen.QrCode.encodeText(url, ecc);
    const border = 4;
    const modules = qr.size + border * 2;
    const maxPx = Math.min(360, Math.max(220, window.innerWidth - 48));
    const scale = Math.max(2, Math.floor(maxPx / modules));
    const canvas = refs.qrCanvas;
    canvas.width = modules * scale;
    canvas.height = modules * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
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
    if (refs.qrBox) refs.qrBox.style.display = "flex";
    if (refs.qrHint) {
      refs.qrHint.textContent = `Tippen: QR=Download • Link=Kopieren • QR v${qr.version} (L) • ${url.length} Zeichen`;
    }
    lastQrUrl = url;
    storeCachedQrUrl(url);
    if (refs.qrUrl) {
      refs.qrUrl.value = url;
      selectQrUrl();
    }
    if (refs.elExportUrl) {
      refs.elExportUrl.value = "";
      refs.elExportUrl.style.display = "none";
    }
  }

  function downloadQrPng(url) {
    if (!window.qrcodegen || !window.qrcodegen.QrCode) return;
    const ecc = window.qrcodegen.QrCode.Ecc.LOW;
    const qr = window.qrcodegen.QrCode.encodeText(url, ecc);
    const border = 4;
    const scale = 10;
    const canvas = document.createElement("canvas");
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

    const date = opts.todayDateStr ? opts.todayDateStr() : "date";
    const wallet = opts.getWallet ? opts.getWallet() : null;
    const safeUserId = String((wallet && wallet.userId) || "user").replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const filename = `db-wallet-${safeUserId}-${date}.png`;

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
    } else {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  async function buildQrUrl() {
    const wallet = opts.getWallet ? opts.getWallet() : null;
    try {
      const actionApi = window.dbWalletActionCodes || null;
      if (actionApi && typeof actionApi.ensureWalletActionCodes === "function") {
        const res = actionApi.ensureWalletActionCodes(wallet);
        if (res && res.changed && opts.saveWallet) {
          opts.saveWallet(wallet);
          if (opts.actionCodesUi && typeof opts.actionCodesUi.refresh === "function") {
            opts.actionCodesUi.refresh();
          }
        }
      }
    } catch (e) {
      // ignore
    }
    if (opts.touchLocalDevice) {
      try {
        opts.touchLocalDevice();
      } catch (e) {
        // ignore
      }
    }
    const theme = opts.getStoredTheme ? opts.getStoredTheme() : null;
    const raw = opts.encodeImportV2Bytes(wallet, theme);
    const base = getBaseUrl();

    try {
      const compressed = await opts.gzipCompress(raw);
      const token = opts.base64UrlEncodeBytes(compressed);
      return `${base}#i2:${token}`;
    } catch (e) {
      const token = opts.base64UrlEncodeBytes(raw);
      return `${base}#i2u:${token}`;
    }
  }

  async function showQrExport() {
    clearQr();
    const cached = loadCachedQrUrl();
    if (cached) {
      try {
        renderQrCode(cached);
        return;
      } catch (e) {
        clearQr();
      }
    }
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      let url = "";
      try {
        url = await buildQrUrl();
        renderQrCode(url);
        return;
      } catch (e) {
        clearQr();
        console.error("QR export failed", e);

        const msg = String(e && e.message ? e.message : e || "");
        if (msg.includes("QR library missing")) {
          alert(
            "QR-Code konnte nicht erzeugt werden (QR-Bibliothek fehlt). Du kannst den Export-Link trotzdem kopieren.",
          );
          return;
        }

        if (msg.includes("Data too long")) {
          if (opts.needsMigration && opts.needsMigration()) {
            const migrated = opts.runMigrationDialog(
              "Zu groß für QR-Export mit v1-Daten. Bitte migrieren.",
              true,
            );
            if (!migrated) return;
            continue;
          }
          alert("Zu groß für QR-Export. Nutze Export-Link oder JSON.");
          return;
        }

        if (opts.needsMigration && opts.needsMigration()) {
          const migrated = opts.runMigrationDialog(
            "QR-Export ist zu groß oder instabil mit v1-Daten. Bitte migrieren.",
            true,
          );
          if (!migrated) return;
          continue;
        }
        alert("QR-Code konnte nicht erzeugt werden.");
        return;
      }
    }
  }

  function init(nextOpts) {
    opts = nextOpts || null;
    refs = (opts && opts.refs) || null;
    lastQrUrl = "";

    if (!opts || !refs) return;

    if (refs.btnExport) {
      refs.btnExport.addEventListener("click", () => {
        if (!refs.exportOptions) return;
        if (
          refs.exportOptions.style.display === "none" ||
          refs.exportOptions.style.display === ""
        ) {
          refs.exportOptions.style.display = "inline-block";
        } else {
          refs.exportOptions.style.display = "none";
          clear();
        }
      });
    }

    if (refs.btnExportLink) {
      refs.btnExportLink.addEventListener("click", () => {
        const wallet = opts.getWallet ? opts.getWallet() : null;
        try {
          const actionApi = window.dbWalletActionCodes || null;
          if (actionApi && typeof actionApi.ensureWalletActionCodes === "function") {
            const res = actionApi.ensureWalletActionCodes(wallet);
            if (res && res.changed && opts.saveWallet) {
              opts.saveWallet(wallet);
              if (opts.actionCodesUi && typeof opts.actionCodesUi.refresh === "function") {
                opts.actionCodesUi.refresh();
              }
            }
          }
        } catch (e) {
          // ignore
        }
        if (opts.touchLocalDevice) {
          try {
            opts.touchLocalDevice();
          } catch (e) {
            // ignore
          }
        }
        const theme = opts.getStoredTheme ? opts.getStoredTheme() : null;
        const payload = JSON.stringify({
          userId: wallet.userId,
          walletId: wallet.walletId,
          v: wallet.v,
          events: wallet.events,
          actionCodes: wallet.actionCodes,
          devices: wallet.devices,
          theme,
        });
        const token = opts.base64UrlEncode(payload);
        const url = getBaseUrl() + "#import:" + token;
        refs.elExportUrl.value = url;
        refs.elExportUrl.style.display = "block";
        refs.elExportUrl.focus();
        refs.elExportUrl.select();
        clearQr();
      });
    }

    if (refs.btnExportLinkQr) {
      refs.btnExportLinkQr.addEventListener("click", showQrExport);
    }

    if (refs.btnExportJson) {
      refs.btnExportJson.addEventListener("click", () => {
        if (opts.downloadCurrentWalletBackup) opts.downloadCurrentWalletBackup("");
      });
    }

    if (refs.elExportUrl) {
      refs.elExportUrl.addEventListener("focus", () => refs.elExportUrl.select());
      refs.elExportUrl.addEventListener("click", () => refs.elExportUrl.select());
    }
    if (refs.qrUrl) {
      refs.qrUrl.addEventListener("focus", selectQrUrl);
      refs.qrUrl.addEventListener("click", selectQrUrl);
    }
    if (refs.qrCanvas) {
      refs.qrCanvas.addEventListener("click", () => {
        if (!lastQrUrl) return;
        downloadQrPng(lastQrUrl);
      });
    }
  }

  window.dbWalletExportUI = {
    init,
    clear,
    openSection,
  };
})();
