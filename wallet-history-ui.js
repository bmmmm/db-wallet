(function () {
  let historyMode = "diagram"; // "diagram" | "log" | "raw"
  let rawScope = "current"; // "current" | "all"
  let rawAllCache = null;

  let refs = null;
  let getWallet = null;
  let getSummary = null;
  let getAllWallets = null;
  let onAfterRender = null;

  function setHistoryMode(mode) {
    historyMode = mode;
    refs.btnModeDiagram.classList.toggle("active", mode === "diagram");
    refs.btnModeLog.classList.toggle("active", mode === "log");
    refs.btnModeRaw.classList.toggle("active", mode === "raw");

    // Raw-Scope-Toggle nur im Raw-Log-Modus anzeigen
    if (refs.rawToggle) {
      refs.rawToggle.style.display = mode === "raw" ? "block" : "none";
    }

    // Log-Bearbeitungsgruppe nur im Historie-Modus sichtbar,
    // Edit-Funktionen erst bei aktivierter Checkbox
    if (refs.logTools) {
      if (mode === "log") {
        refs.logTools.style.display = "block";
        if (refs.logEditGroup && refs.logEditToggle) {
          refs.logEditGroup.style.display = refs.logEditToggle.checked
            ? "block"
            : "none";
        }
      } else {
        refs.logTools.style.display = "none";
      }
    }

    // Beim Wechsel auf Diagramm oder Historie immer auf "diese:n Nutzer:in" für Raw zurücksetzen
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
    refs.btnRawCurrent.classList.toggle("active", scope === "current");
    refs.btnRawAll.classList.toggle("active", scope === "all");
    if (historyMode === "raw") {
      window.dbWalletHistoryUI.render();
    }
  }

  function formatLogLine(e, index) {
    const d = new Date(e.ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dateStr = `${y}-${m}-${day}`;
    const timeStr = `${hh}:${mm}`;
    let action = "";
    const n =
      typeof e.n === "number" && isFinite(e.n)
        ? Math.max(1, Math.round(e.n))
        : 1;
    if (e.t === "d") action = `+${n} Getränk(e)`;
    else if (e.t === "s") action = `↩️ ${n} zurückgenommen`;
    else if (e.t === "p") action = "Bezahlt";
    else if (e.t === "g") action = `Gutschrift ${n} Getränk(e)`;
    return `#${index} | ${dateStr} ${timeStr} | ${action}`;
  }

  window.dbWalletHistoryUI = {
    init(params) {
      refs = params.refs;
      getWallet = params.getWallet;
      getSummary = params.getSummary;
      getAllWallets = params.getAllWallets;
      onAfterRender = params.onAfterRender;

      if (refs.logEditToggle) {
        refs.logEditToggle.addEventListener("change", () => {
          if (historyMode === "log" && refs.logEditGroup) {
            refs.logEditGroup.style.display = refs.logEditToggle.checked
              ? "block"
              : "none";
          }
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
          const lines = summary.perDay
            .slice()
            .reverse()
            .map((d) => {
              const bar = "#".repeat(Math.min(d.drinks, 50));
              const paidMark = d.paid ? " 💰" : "";
              return `${d.date}${paidMark} | ${bar}`;
            });
          refs.elHistory.textContent = lines.join("\n");
        }
      } else if (historyMode === "log") {
        if (!summary.eventsSorted.length) {
          refs.elHistory.textContent = "Noch keine Drinks geloggt. ✨";
        } else {
          const lines = [];
          const len = summary.eventsSorted.length;
          for (let i = len - 1; i >= 0; i--) {
            const idx = i + 1; // 1-basiert
            lines.push(formatLogLine(summary.eventsSorted[i], idx));
          }
          refs.elHistory.textContent = lines.join("\n");
        }
      } else if (historyMode === "raw") {
        if (rawScope === "current") {
          refs.elHistory.textContent = JSON.stringify(wallet, null, 2);
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
    },
  };
})();
