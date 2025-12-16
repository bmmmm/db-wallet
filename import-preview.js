(() => {
  const CACHE_PREFIX = "db-wallet:import-cache:";

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function randomToken(len = 18) {
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

  function normalizeWalletForSummary(wallet) {
    const src = wallet && typeof wallet === "object" ? wallet : {};
    const eventsRaw = Array.isArray(src.events) ? src.events : [];

    const events = [];
    for (const ev of eventsRaw) {
      if (!ev || typeof ev !== "object") continue;
      const t = typeof ev.t === "string" ? ev.t : "";
      if (!t) continue;
      const id = typeof ev.id === "string" ? ev.id : "";
      let ts =
        typeof ev.ts === "number" && Number.isFinite(ev.ts) ? ev.ts : NaN;
      if (!Number.isFinite(ts)) {
        const parsed =
          typeof ev.ts === "string" && ev.ts.trim() !== ""
            ? Number(ev.ts)
            : NaN;
        ts = Number.isFinite(parsed) ? parsed : 0;
      }
      const n =
        typeof ev.n === "number" && Number.isFinite(ev.n)
          ? ev.n
          : typeof ev.n === "string" && ev.n.trim() !== ""
            ? Number(ev.n)
            : undefined;
      events.push({ id, t, n, ts });
    }

    return {
      userId: typeof src.userId === "string" ? src.userId : "",
      v:
        typeof src.v === "number" && Number.isFinite(src.v) && src.v > 0
          ? src.v
          : 1,
      events,
    };
  }

  function computeSummary(wallet) {
    const normalized = normalizeWalletForSummary(wallet);
    const eventsSorted = normalized.events.slice().sort((a, b) => {
      return a.ts - b.ts || a.id.localeCompare(b.id);
    });

    let total = 0;
    const perDayMap = new Map();
    let balance = 0;

    function dayKey(ts) {
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    for (const e of eventsSorted) {
      const key = dayKey(e.ts);
      if (!perDayMap.has(key)) {
        perDayMap.set(key, { date: key, drinks: 0, paid: false });
      }
      const day = perDayMap.get(key);

      if (e.t === "d") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        total += n;
        day.drinks += n;
        balance += n;
      } else if (e.t === "s") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        total -= n;
        day.drinks -= n;
        balance -= n;
      } else if (e.t === "p") {
        day.paid = true;
        if (balance > 0) balance = 0;
      } else if (e.t === "g") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        balance -= n;
      }
    }

    for (const d of perDayMap.values()) {
      if (d.drinks < 0) d.drinks = 0;
    }
    if (total < 0) total = 0;

    const unpaid = Math.max(balance, 0);
    const credit = Math.max(-balance, 0);
    const perDay = Array.from(perDayMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      userId: normalized.userId,
      v: normalized.v,
      total,
      unpaid,
      credit,
      perDay,
      eventsSorted,
    };
  }

  function applyThemeTransient(themeName) {
    const api = window.dbWalletTheme || null;
    const canonical =
      api && typeof api.canonicalThemeName === "function"
        ? api.canonicalThemeName(themeName)
        : String(themeName || "").trim();
    if (!canonical) return false;
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
        const lines = summary.perDay
          .slice()
          .reverse()
          .map((d) => {
            const bar = "#".repeat(Math.min(d.drinks, 50));
            const paidMark = d.paid ? " 💰" : "";
            return `${d.date}${paidMark} | ${bar}`;
          });
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
