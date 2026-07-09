(function () {
  const summaryApi = window.dbWalletSummary || null;
  let historyMode = "diagram"; // "diagram" | "log" | "raw"
  let rawScope = "current"; // "current" | "all"
  let rawAllCache = null;
  let rawCurrentCache = null;

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

    // Log-editing tools are only visible in history mode,
    // edit functions only once the checkbox is enabled
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
    refs.btnRawCurrent.classList.toggle("active", scope === "current");
    refs.btnRawAll.classList.toggle("active", scope === "all");
    if (historyMode === "raw") {
      window.dbWalletHistoryUI.render();
    }
  }

  // Single source of truth lives in dbWalletSummary (loaded before this module).
  // The trivial fallback only guards the impossible case where summary is absent —
  // it does not duplicate the formatting logic (which would drift out of sync).
  const formatLogLine =
    summaryApi && typeof summaryApi.formatLogLine === "function"
      ? summaryApi.formatLogLine
      : (e, index) => `#${index} | ${new Date(e.ts).toISOString()} | ${e.t}`;

  const formatPerDayDiagram =
    summaryApi && typeof summaryApi.formatPerDayDiagram === "function"
      ? summaryApi.formatPerDayDiagram
      : (perDay) =>
          perDay.map((d) => {
            const drinkCount =
              typeof d.drinkCount === "number" &&
              Number.isFinite(d.drinkCount)
                ? d.drinkCount
                : typeof d.drinks === "number" && Number.isFinite(d.drinks)
                  ? Math.max(0, Math.round(d.drinks))
                  : 0;
            const bar = "#".repeat(Math.max(0, Math.min(d.drinks, 50)));
            const paidMark = d.paid ? " 💰" : "";
            return `${d.date} [${drinkCount}]${paidMark} | ${bar}`;
          });

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
          const lines = formatPerDayDiagram(summary.perDay.slice().reverse());
          refs.elHistory.textContent = lines.join("\n");
        }
      } else if (historyMode === "log") {
        if (!summary.eventsSorted.length) {
          refs.elHistory.textContent = "Noch keine Drinks geloggt. ✨";
        } else {
          const lines = [];
          const len = summary.eventsSorted.length;
          // Cap rendering of very long logs so the DOM write stays cheap; the
          // newest entries are shown and the remainder is summarized.
          const MAX_LINES = 2000;
          const shown = Math.min(len, MAX_LINES);
          for (let k = 0; k < shown; k++) {
            const i = len - 1 - k; // newest first
            lines.push(formatLogLine(summary.eventsSorted[i], i + 1));
          }
          if (len > MAX_LINES) {
            // Name the hidden index range so a delete-by-range still has a
            // visible boundary (the OLDEST entries, #1..#(len-MAX_LINES), are the
            // ones truncated).
            lines.push(
              `… und ${len - MAX_LINES} ältere Einträge (IDs #1–#${len - MAX_LINES}) nicht angezeigt.`,
            );
          }
          refs.elHistory.textContent = lines.join("\n");
        }
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
