(() => {
  const helpers = window.dbWalletHelpers || null;
  const CACHE_PREFIX = "db-wallet:import-cache:";

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

  function cacheSet(payload) {
    // Resolved lazily at call time (unlike `helpers` above): on wallet.html
    // this script loads before wallet-helpers.js, so a module-load-time
    // binding would permanently miss the real implementation. Safe because
    // cacheSet only ever runs from a user-triggered import action, long after
    // all deferred scripts have executed — nothing here runs at IIFE eval
    // time.
    const token = window.dbWalletHelpers.randomToken();
    try {
      sessionStorage.setItem(CACHE_PREFIX + token, JSON.stringify(payload));
      return token;
    } catch (e) {
      return null;
    }
  }

  function cacheGet(token) {
    if (!token) return null;
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + token);
      if (!raw) return null;
      return safeParse(raw);
    } catch (e) {
      return null;
    }
  }

  function cacheDelete(token) {
    if (!token) return;
    try {
      sessionStorage.removeItem(CACHE_PREFIX + token);
    } catch (e) {
      // ignore
    }
  }

  let activeChoiceDialog = null;

  function chooseImportMode(context = {}) {
    return new Promise((resolve) => {
      const header = context.header || "Import: Was möchtest du tun?";

      if (!document || !document.body) {
        resolve(null);
        return;
      }

      if (
        activeChoiceDialog &&
        typeof activeChoiceDialog.finish === "function"
      ) {
        activeChoiceDialog.finish(null);
      }

      const overlay = document.createElement("div");
      overlay.className = "import-choice-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");

      const modal = document.createElement("div");
      modal.className = "import-choice-modal";
      modal.addEventListener("click", (e) => e.stopPropagation());

      const title = document.createElement("div");
      title.className = "import-choice-title";
      title.textContent = header;

      const subtitle = document.createElement("div");
      subtitle.className = "import-choice-subtitle";
      subtitle.textContent = "Wähle eine Option:";

      const actions = document.createElement("div");
      actions.className = "import-choice-actions";

      const btnPersist = document.createElement("button");
      btnPersist.className = "import-choice-btn";
      const persistTitle = document.createElement("div");
      persistTitle.className = "import-choice-btn-title";
      persistTitle.textContent = "Lokal importieren";
      const persistSub = document.createElement("div");
      persistSub.className = "import-choice-btn-sub";
      persistSub.textContent = "(wie bisher)";
      btnPersist.appendChild(persistTitle);
      btnPersist.appendChild(persistSub);

      const btnPreview = document.createElement("button");
      btnPreview.className = "import-choice-btn";
      const previewTitle = document.createElement("div");
      previewTitle.className = "import-choice-btn-title";
      previewTitle.textContent = "Nur ansehen";
      const previewSub = document.createElement("div");
      previewSub.className = "import-choice-btn-sub";
      previewSub.textContent = "(Read-Only, nicht speichern)";
      btnPreview.appendChild(previewTitle);
      btnPreview.appendChild(previewSub);

      const btnCancel = document.createElement("button");
      btnCancel.className = "import-choice-cancel";
      btnCancel.textContent = "Abbrechen";

      let done = false;
      const prevOverflow = document.body.style.overflow;

      function finish(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onOverlayClick);
        document.body.style.overflow = prevOverflow;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (activeChoiceDialog && activeChoiceDialog.overlay === overlay) {
          activeChoiceDialog = null;
        }
        resolve(result);
      }

      function onKeyDown(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }

      function onOverlayClick() {
        finish(null);
      }

      btnPersist.addEventListener("click", () => finish("persist"));
      btnPreview.addEventListener("click", () => finish("preview"));
      btnCancel.addEventListener("click", () => finish(null));

      actions.appendChild(btnPersist);
      actions.appendChild(btnPreview);
      actions.appendChild(btnCancel);

      modal.appendChild(title);
      modal.appendChild(subtitle);
      modal.appendChild(actions);
      overlay.appendChild(modal);

      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKeyDown);
      overlay.addEventListener("click", onOverlayClick);
      document.body.appendChild(overlay);
      activeChoiceDialog = { overlay, finish };

      setTimeout(() => btnPersist.focus(), 0);
    });
  }

  function openPreview(payload) {
    const token = cacheSet(payload);
    if (!token) {
      alert(
        "Read-Only Vorschau konnte nicht geöffnet werden (Session-Cache voll oder nicht verfügbar).",
      );
      return false;
    }
    window.location.href = "preview.html#" + token;
    return true;
  }

  function computeSummary(wallet) {
    const summaryApi = window.dbWalletSummary || null;
    if (summaryApi && typeof summaryApi.computeSummarySafe === "function") {
      return summaryApi.computeSummarySafe(wallet);
    }
    return {
      userId: wallet && typeof wallet.userId === "string" ? wallet.userId : "",
      v: 1,
      total: 0,
      unpaid: 0,
      credit: 0,
      perDay: [],
      eventsSorted: [],
    };
  }

  // Resolved lazily at call time, same as computeSummary above: on wallet.html
  // this script loads before wallet-summary.js, so a module-load-time binding
  // would permanently miss the real implementation.
  function formatPerDayDiagram(perDay) {
    const summaryApi = window.dbWalletSummary || null;
    if (summaryApi && typeof summaryApi.formatPerDayDiagram === "function") {
      return summaryApi.formatPerDayDiagram(perDay);
    }
    return perDay.map((d) => {
      const drinkCount =
        typeof d.drinkCount === "number" && Number.isFinite(d.drinkCount)
          ? d.drinkCount
          : typeof d.drinks === "number" && Number.isFinite(d.drinks)
            ? Math.max(0, Math.round(d.drinks))
            : 0;
      const bar = "#".repeat(Math.max(0, Math.min(d.drinks, 50)));
      const paidMark = d.paid ? " 💰" : "";
      return `${d.date} [${drinkCount}]${paidMark} | ${bar}`;
    });
  }

  function applyThemeTransient(themeName) {
    const api = window.dbWalletTheme || null;
    const canonical =
      api && typeof api.canonicalThemeName === "function"
        ? api.canonicalThemeName(themeName)
        : String(themeName || "").trim();
    if (!canonical) return false;
    // Gate on the theme whitelist exactly like theme.js applyTheme: an imported
    // wallet's theme string is attacker-controlled, so an out-of-whitelist value
    // must be ignored, not written raw as a data-theme attribute.
    if (
      api &&
      typeof api.isSelectableThemeName === "function" &&
      !api.isSelectableThemeName(canonical)
    ) {
      return false;
    }
    document.documentElement.setAttribute("data-theme", canonical);
    return true;
  }

  function renderPreviewPage(token) {
    const payload = cacheGet(token);
    const wallet = payload && payload.wallet ? payload.wallet : null;
    const theme =
      payload && typeof payload.theme === "string" ? payload.theme : "";

    const elUid = document.getElementById("uid");
    const elWalletVersion = document.getElementById("wallet-version");
    const elTotal = document.getElementById("total");
    const elUnpaid = document.getElementById("unpaid");
    const elCredit = document.getElementById("credit");
    const elHistory = document.getElementById("history");
    const btnExit = document.getElementById("btn-exit");

    function exit() {
      cacheDelete(token);
      window.location.href = "index.html";
    }

    if (btnExit) {
      btnExit.addEventListener("click", exit);
    }

    if (!payload || !wallet || typeof wallet !== "object") {
      if (elUid) elUid.textContent = "–";
      if (elWalletVersion) elWalletVersion.textContent = "v–";
      if (elTotal) elTotal.textContent = "0";
      if (elUnpaid) elUnpaid.textContent = "0";
      if (elCredit) elCredit.textContent = "0";
      if (elHistory) {
        elHistory.textContent =
          "Keine Import-Daten im Session-Cache gefunden.\n\nBitte Import erneut starten.";
      }
      return;
    }

    if (theme) {
      applyThemeTransient(theme);
    }

    const summary = computeSummary(wallet);

    if (elUid) elUid.textContent = summary.userId || "unbekannt";
    if (elWalletVersion) elWalletVersion.textContent = `v${summary.v || 1}`;
    if (elTotal) elTotal.textContent = String(summary.total);
    if (elUnpaid) elUnpaid.textContent = String(summary.unpaid);
    if (elCredit) elCredit.textContent = String(summary.credit);

    if (elHistory) {
      if (!summary.perDay.length) {
        elHistory.textContent = "Noch keine Drinks geloggt. ✨";
      } else {
        const lines = formatPerDayDiagram(summary.perDay.slice().reverse());
        elHistory.textContent = lines.join("\n");
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!document.body || document.body.dataset.page !== "preview") return;
    const token = window.location.hash.slice(1);
    renderPreviewPage(token);
  });

  window.dbWalletImportPreview = {
    chooseImportMode,
    openPreview,
    cacheSet,
    cacheGet,
    cacheDelete,
    computeSummary,
  };
})();
