(() => {
  // Loads after wallet-helpers.js and wallet-summary.js on every page
  // (index.html, wallet.html, preview.html), so both are bound once here.
  const helpers = window.dbWalletHelpers || null;
  const summaryApi = window.dbWalletSummary || null;
  if (
    !helpers ||
    typeof helpers.safeParse !== "function" ||
    typeof helpers.randomToken !== "function" ||
    !summaryApi ||
    typeof summaryApi.computeSummarySafe !== "function" ||
    typeof summaryApi.formatPerDayDiagram !== "function"
  ) {
    return;
  }
  const { safeParse, randomToken } = helpers;
  const CACHE_PREFIX = "db-wallet:import-cache:";

  function cacheSet(payload) {
    const token = randomToken();
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

  // P4.9: a native modal <dialog> (focus stays inside, Escape = cancel), and
  // the focus goes back to where it was. Resolves "persist", "preview" or
  // null (Abbrechen, Escape, a click on the backdrop).
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

      const opener = document.activeElement || null;

      const dialog = document.createElement("dialog");
      dialog.className = "import-choice-dialog";
      dialog.setAttribute("aria-labelledby", "import-choice-title");

      // The content box: a click on the dialog element itself is a click on
      // the backdrop (the dialog has no padding of its own).
      const modal = document.createElement("div");
      modal.className = "import-choice-modal";

      const title = document.createElement("h2");
      title.id = "import-choice-title";
      title.className = "import-choice-title";
      title.textContent = header;

      const subtitle = document.createElement("p");
      subtitle.className = "import-choice-subtitle";
      subtitle.textContent = "Wähle eine Option:";

      const actions = document.createElement("div");
      actions.className = "import-choice-actions";

      const makeChoice = (label, sub) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "import-choice-btn";
        const t = document.createElement("span");
        t.className = "import-choice-btn-title";
        t.textContent = label;
        const st = document.createElement("span");
        st.className = "import-choice-btn-sub";
        st.textContent = sub;
        btn.appendChild(t);
        btn.appendChild(st);
        return btn;
      };
      const btnPersist = makeChoice("Lokal importieren", "(auf diesem Gerät speichern)");
      const btnPreview = makeChoice("Nur ansehen", "(Read-Only, nicht speichern)");

      const btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "import-choice-cancel";
      btnCancel.textContent = "Abbrechen";

      let done = false;

      function finish(result) {
        if (done) return;
        done = true;
        dialog.removeEventListener("cancel", onCancel);
        dialog.removeEventListener("close", onClose);
        dialog.removeEventListener("click", onBackdrop);
        if (dialog.open && typeof dialog.close === "function") {
          try {
            dialog.close();
          } catch (e) {
            // ignore
          }
        }
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        if (activeChoiceDialog && activeChoiceDialog.dialog === dialog) {
          activeChoiceDialog = null;
        }
        if (opener && typeof opener.focus === "function" && opener !== document.body) {
          try {
            opener.focus();
          } catch (e) {
            // ignore
          }
        }
        resolve(result);
      }

      // Escape: the browser fires "cancel", then closes the dialog.
      function onCancel(e) {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        finish(null);
      }

      function onClose() {
        finish(null);
      }

      function onBackdrop(e) {
        if (e && e.target === dialog) finish(null);
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
      dialog.appendChild(modal);

      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClose);
      dialog.addEventListener("click", onBackdrop);
      document.body.appendChild(dialog);
      activeChoiceDialog = { dialog, finish };

      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
        dialog.open = true;
      }
      if (typeof btnPersist.focus === "function") btnPersist.focus();
    });
  }

  function openPreview(payload) {
    const token = cacheSet(payload);
    if (!token) {
      helpers.notify(
        "Read-Only Vorschau konnte nicht geöffnet werden (Session-Cache voll oder nicht verfügbar).",
        { kind: "error" },
      );
      return false;
    }
    window.location.href = "preview.html#" + token;
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

    // theme.js (in preview.html's <head>) checks the name against its
    // whitelist — the imported theme string is untrusted — and persist:false
    // keeps the user's own stored theme.
    const themeApi = window.dbWalletTheme || null;
    if (theme && themeApi) themeApi.applyTheme(theme, { persist: false });

    const summary = summaryApi.computeSummarySafe(wallet);

    if (elUid) elUid.textContent = summary.userId || "unbekannt";
    if (elWalletVersion) elWalletVersion.textContent = `v${summary.v || 1}`;
    if (elTotal) elTotal.textContent = String(summary.total);
    if (elUnpaid) elUnpaid.textContent = String(summary.unpaid);
    if (elCredit) elCredit.textContent = String(summary.credit);

    if (elHistory) {
      if (!summary.perDay.length) {
        elHistory.textContent = "Noch keine Drinks geloggt. ✨";
      } else {
        const lines = summaryApi.formatPerDayDiagram(summary.perDay.slice().reverse());
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
  };
})();
