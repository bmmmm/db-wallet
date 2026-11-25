(function () {
  const helpers = window.dbWalletHelpers || null;
  if (!helpers || typeof helpers.drawQrToCanvas !== "function") return;

  let opts = null;
  let refs = null;

  let lastQrUrl = "";

  // Hides and clears the rendered QR, its link and status.
  function clearQr() {
    if (refs && refs.qrBox) refs.qrBox.style.display = "none";
    if (refs && refs.qrHint) refs.qrHint.textContent = "";
    if (refs && refs.qrCanvas) {
      const ctx = refs.qrCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, refs.qrCanvas.width, refs.qrCanvas.height);
    }
    if (refs && refs.qrUrl) refs.qrUrl.value = "";
    setStatus(refs && refs.qrUrlStatus, "");
    lastQrUrl = "";
  }

  // Shows the classic link field with `url` (and its Kopieren/Teilen row), or
  // hides both for an empty url.
  function setExportUrl(url) {
    if (!refs || !refs.elExportUrl) return;
    const show = !!url;
    refs.elExportUrl.value = url || "";
    refs.elExportUrl.style.display = show ? "block" : "none";
    if (refs.exportUrlActions) refs.exportUrlActions.style.display = show ? "flex" : "none";
    setStatus(refs.exportUrlStatus, "");
    if (show) updateShareButtons();
  }

  // --- Kopieren / Teilen -------------------------------------------------------

  function getNavigator() {
    return (typeof window !== "undefined" && window.navigator) || null;
  }

  function canShare() {
    const nav = getNavigator();
    return !!(nav && typeof nav.share === "function");
  }

  // "Teilen" only where the Web Share API exists (mostly mobile).
  function updateShareButtons() {
    if (!refs) return;
    const hide = !canShare();
    if (refs.btnShareExportUrl) refs.btnShareExportUrl.hidden = hide;
    if (refs.btnShareQrUrl) refs.btnShareQrUrl.hidden = hide;
  }

  function setStatus(el, text) {
    if (el) el.textContent = text;
  }

  // Focuses a link field (without scrolling) and selects all of it.
  function selectField(el) {
    if (!el) return;
    if (document.activeElement !== el) {
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        try {
          el.focus();
        } catch (e2) {
          // ignore
        }
      }
    }
    try {
      el.select();
      el.setSelectionRange(0, String(el.value || "").length);
    } catch (e) {
      // ignore
    }
  }

  // Legacy path for browsers without the async Clipboard API (or when it is
  // blocked, e.g. on plain http): copies the selection of `field`.
  function execCopy(field) {
    selectField(field);
    try {
      return typeof document.execCommand === "function" && document.execCommand("copy") === true;
    } catch (e) {
      return false;
    }
  }

  async function copyLink(field, statusEl) {
    const url = field ? String(field.value || "") : "";
    if (!url) return false;
    const nav = getNavigator();
    let ok = false;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      try {
        await nav.clipboard.writeText(url);
        ok = true;
      } catch (e) {
        ok = false;
      }
    }
    if (!ok) ok = execCopy(field);
    if (ok) {
      setStatus(statusEl, "Link kopiert.");
    } else {
      selectField(field);
      setStatus(
        statusEl,
        "Kopieren nicht möglich: Der Link ist markiert, bitte selbst kopieren.",
      );
    }
    return ok;
  }

  // O3.4: the shared link is a bearer credential — it carries the whole event
  // log, the userId and the action-code keys, unencrypted. The first "Teilen"
  // on a device says so in the status line and shares only from its button
  // (a fresh tap, so the share sheet still has its user activation).
  const SHARE_HINT_KEY = "db-wallet.share-hint-seen";
  const SHARE_HINT =
    "Bevor du teilst: Der Link enthält dein ganzes Wallet, alle Buchungen und die Schlüssel deiner Action Codes, unverschlüsselt. Wer ihn hat, kann das Wallet übernehmen. Nur an eigene Geräte oder Leute schicken, denen du es geben willst.";

  function shareHintSeen() {
    return helpers.safeLocalStorageGetItem(SHARE_HINT_KEY) === "1";
  }

  async function shareLink(field, statusEl) {
    const url = field ? String(field.value || "") : "";
    if (!url) return;
    const nav = getNavigator();
    if (!nav || typeof nav.share !== "function") {
      await copyLink(field, statusEl);
      return;
    }
    if (!shareHintSeen()) {
      helpers.notify(SHARE_HINT, {
        sticky: true,
        action: {
          label: "Teilen",
          run: () => {
            helpers.safeLocalStorageSetItem(SHARE_HINT_KEY, "1");
            shareLink(field, statusEl);
          },
        },
      });
      return;
    }
    setStatus(statusEl, "");
    try {
      await nav.share({ title: "db-wallet Export", url });
    } catch (e) {
      // AbortError = the user closed the share sheet: nothing to do.
      if (e && e.name === "AbortError") return;
      await copyLink(field, statusEl);
    }
  }

  function clear() {
    if (!refs) return;
    setExportUrl("");
    clearQr();
  }

  // The export options (hidden by style.css, so an inline "" is closed);
  // "Export" says whether they are open (aria-expanded).
  function optionsOpen() {
    const d = refs.exportOptions.style.display;
    return d !== "none" && d !== "";
  }

  function setOptionsOpen(open) {
    refs.exportOptions.style.display = open ? "inline-block" : "none";
    if (refs.btnExport) refs.btnExport.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function openSection() {
    if (!refs || !refs.btnExport || !refs.exportOptions) return;
    try {
      refs.btnExport.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      // ignore
    }
    if (!optionsOpen()) setOptionsOpen(true);
  }

  // Width (CSS px) the QR may take: the content box of #qr-box, measured
  // while it is shown. The old estimate (innerWidth - 48) missed the panel
  // padding, so on a 360 px phone `max-width: 100%` squeezed the canvas and
  // the modules left the device-pixel grid (O3.5). 1 px of slack absorbs the
  // rounding of clientWidth.
  function qrAvailableCssWidth() {
    const box = refs && refs.qrBox;
    const cw = box ? Number(box.clientWidth) : 0;
    if (Number.isFinite(cw) && cw > 0) {
      let pad = 0;
      try {
        const cs = typeof window.getComputedStyle === "function" ? window.getComputedStyle(box) : null;
        if (cs) pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      } catch (e) {
        pad = 0;
      }
      const inner = Math.floor(cw - pad) - 1;
      if (inner > 0) return Math.min(360, inner);
    }
    const vw = Number(window.innerWidth);
    return Number.isFinite(vw) && vw > 0 ? Math.min(360, Math.max(220, vw - 48)) : 360;
  }

  // Draws the export QR for `url` into #qr-canvas: backing store at
  // devicePixelRatio with an integer number of device pixels per module, and a
  // CSS width of backing / dpr that fits the box, so the browser shows it 1:1
  // instead of stretching it (blurry or uneven modules). Returns the QrCode.
  function drawExportQr(url) {
    if (!window.qrcodegen || !window.qrcodegen.QrCode || !refs || !refs.qrCanvas) {
      throw new Error("QR library missing");
    }
    const ecc = window.qrcodegen.QrCode.Ecc.LOW;
    const qr = window.qrcodegen.QrCode.encodeText(url, ecc);
    if (refs.qrBox) refs.qrBox.style.display = "flex";
    const cssMax = qrAvailableCssWidth();
    const dprRaw = Number(window.devicePixelRatio);
    const dpr = Number.isFinite(dprRaw) && dprRaw >= 1 ? Math.min(dprRaw, 4) : 1;
    const maxPx = Math.floor(cssMax * dpr);
    const canvas = refs.qrCanvas;
    helpers.drawQrToCanvas(canvas, url, { maxPx });
    // Only the width: height stays "auto" (style.css), so the code stays
    // square even if a container still clamps it.
    canvas.style.width = `${canvas.width / dpr}px`;
    return qr;
  }

  // Rotation / window resize changes the box width: redraw the shown QR
  // (canvas only — no focus or status change).
  let qrResizeTimer = null;
  let qrResizeBound = false;
  function onQrResize() {
    if (qrResizeTimer) clearTimeout(qrResizeTimer);
    qrResizeTimer = setTimeout(() => {
      qrResizeTimer = null;
      if (!lastQrUrl || !refs || !refs.qrBox || refs.qrBox.style.display !== "flex") return;
      try {
        drawExportQr(lastQrUrl);
      } catch (e) {
        // keep the old drawing
      }
    }, 150);
  }

  function renderQrCode(url) {
    const qr = drawExportQr(url);
    if (refs.qrHint) {
      refs.qrHint.textContent = `QR antippen = als PNG speichern • QR v${qr.version} (L) • ${url.length} Zeichen`;
    }
    lastQrUrl = url;
    if (refs.qrUrl) {
      refs.qrUrl.value = url;
      selectField(refs.qrUrl);
    }
    setStatus(refs.qrUrlStatus, "");
    updateShareButtons();
    setExportUrl("");
  }

  // The PNG is drawn anew at 10 px per module (sharper than the shown QR).
  function downloadQrPng(url) {
    if (!window.qrcodegen || !window.qrcodegen.QrCode) return;
    const canvas = document.createElement("canvas");
    helpers.drawQrToCanvas(canvas, url, { scale: 10 });
    const wallet = opts.getWallet();
    const safeUserId = String((wallet && wallet.userId) || "user").replace(/[^a-zA-Z0-9_-]/g, "_");
    canvas.toBlob((blob) => {
      if (blob) helpers.downloadBlob(blob, `db-wallet-${safeUserId}-${opts.todayDateStr()}.png`);
    }, "image/png");
  }

  async function buildQrUrl() {
    opts.prepareExport();
    const wallet = opts.getWallet();
    const theme = opts.getStoredTheme ? opts.getStoredTheme() : null;
    const raw = opts.encodeImportV2Bytes(wallet, theme);
    const base = opts.getBaseUrl();

    try {
      const compressed = await opts.gzipCompress(raw);
      const token = opts.base64UrlEncodeBytes(compressed);
      return `${base}#i2:${token}`;
    } catch (e) {
      const token = opts.base64UrlEncodeBytes(raw);
      return `${base}#i2u:${token}`;
    }
  }

  // No QR, but the compact i2: link is already built and works as a link —
  // offer it in the link field instead of throwing it away. Either the data
  // no longer fits a version-40 QR (roughly 560 entries, about 475 with 10 %
  // deletions since the compact tombstones of P5.5; P2.5), or qrcodegen.js
  // did not load.
  function showCompactLinkInstead(url, reason, notifyOpts) {
    if (!refs || !refs.elExportUrl) return;
    setExportUrl(url);
    helpers.notify(
      `${reason} Stattdessen steht der kompakte Export-Link (${url.length} Zeichen) im Linkfeld: kopieren und auf dem anderen Gerät öffnen.`,
      Object.assign({ sticky: true }, notifyOpts),
    );
    selectField(refs.elExportUrl);
  }

  async function showQrExport() {
    clearQr();
    // qrcodegen.js loads on first use (P5.6). A failed load leaves the
    // library missing; drawExportQr then reports it below.
    try {
      await helpers.loadQrLibrary();
    } catch (e) {
      // handled by the "QR library missing" path
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
          if (url) {
            showCompactLinkInstead(url, "QR-Code konnte nicht erzeugt werden (QR-Bibliothek fehlt).", {
              kind: "error",
            });
          } else {
            helpers.notify("QR-Code konnte nicht erzeugt werden (QR-Bibliothek fehlt).", {
              kind: "error",
            });
          }
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
          if (url) {
            showCompactLinkInstead(url, "Zu groß für einen QR-Code.");
          } else {
            helpers.notify("Zu groß für QR-Export. Nutze den JSON-Download.", {
              kind: "error",
            });
          }
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
        helpers.notify("QR-Code konnte nicht erzeugt werden.", { kind: "error" });
        return;
      }
    }
    // Reached only if every attempt (incl. post-migration retries) failed
    // without returning — never leave the user without feedback.
    helpers.notify(
      "QR-Code konnte nach Migration nicht erzeugt werden. Bitte den JSON-Download nutzen.",
      { kind: "error" },
    );
  }

  function init(nextOpts) {
    opts = nextOpts || null;
    refs = (opts && opts.refs) || null;
    lastQrUrl = "";

    if (!opts || !refs) return;

    if (refs.btnExport) {
      refs.btnExport.addEventListener("click", () => {
        if (!refs.exportOptions) return;
        if (!optionsOpen()) {
          setOptionsOpen(true);
        } else {
          setOptionsOpen(false);
          clear();
        }
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

    for (const field of [refs.elExportUrl, refs.qrUrl]) {
      if (!field) continue;
      field.addEventListener("focus", () => selectField(field));
      field.addEventListener("click", () => selectField(field));
    }
    const bind = (btn, fn, field, status) => {
      if (btn) btn.addEventListener("click", () => fn(field, status));
    };
    bind(refs.btnCopyExportUrl, copyLink, refs.elExportUrl, refs.exportUrlStatus);
    bind(refs.btnShareExportUrl, shareLink, refs.elExportUrl, refs.exportUrlStatus);
    bind(refs.btnCopyQrUrl, copyLink, refs.qrUrl, refs.qrUrlStatus);
    bind(refs.btnShareQrUrl, shareLink, refs.qrUrl, refs.qrUrlStatus);
    updateShareButtons();

    if (refs.qrCanvas) {
      const saveQrPng = () => {
        if (lastQrUrl) downloadQrPng(lastQrUrl);
      };
      refs.qrCanvas.addEventListener("click", saveQrPng);
      // role="button" (wallet.html): Enter and Space act like a click.
      refs.qrCanvas.addEventListener("keydown", (e) => {
        if (!e || (e.key !== "Enter" && e.key !== " ")) return;
        if (typeof e.preventDefault === "function") e.preventDefault();
        saveQrPng();
      });
    }
    if (!qrResizeBound && typeof window.addEventListener === "function") {
      qrResizeBound = true;
      window.addEventListener("resize", onQrResize);
    }
  }

  window.dbWalletExportUI = {
    init,
    clear,
    openSection,
  };
})();
