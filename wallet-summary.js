(function () {
  function cmpStr(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function todayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function dateStrFromTimestamp(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  let computeSummarySafeLogged = false;

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

  // liefert auch die sortierten Events zurück
  // Erweiterung: unterstützt jetzt auch Gutschriften ("g")
  // Balance-Logik:
  //  - "d" (Drink)      => balance += n
  //  - "s" (Subtract)   => balance -= n
  //  - "g" (Gutschrift) => balance -= n
  //  - "p" (Bezahlt)    => wenn balance > 0, dann balance = 0
  // Am Ende:
  //  - unpaid  = max(balance, 0)       (offene Getränke)
  //  - credit  = max(-balance, 0)      (verbleibende Gutschrift in Getränken)
  function computeSummary(wallet) {
    const eventsSorted = wallet.events
      .slice()
      .sort((a, b) => a.ts - b.ts || cmpStr(a.id, b.id));

    let total = 0;
    const perDayMap = new Map();
    let balance = 0; // >0 = offene Getränke, <0 = Guthaben

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
        perDayMap.set(key, {
          date: key,
          drinks: 0,
          drinkCount: 0,
          paid: false,
        });
      }
      const day = perDayMap.get(key);

      if (e.t === "d") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        total += n;
        day.drinks += n;
        day.drinkCount += n;
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
        if (balance > 0) {
          balance = 0;
        }
      } else if (e.t === "g") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        // Gutschriften zählen nicht in die Tages-Drinkmenge
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
      cmpStr(a.date, b.date),
    );

    return { total, unpaid, credit, perDay, eventsSorted };
  }

  function computeSummarySafe(wallet) {
    const userId =
      wallet && typeof wallet.userId === "string" ? wallet.userId : "";
    const v =
      wallet &&
      typeof wallet.v === "number" &&
      Number.isFinite(wallet.v) &&
      wallet.v > 0
        ? wallet.v
        : 1;
    let didLog = false;

    function logOnce(err, label) {
      if (didLog || computeSummarySafeLogged) return;
      didLog = true;
      computeSummarySafeLogged = true;
      console.error(
        "dbWalletSummary.computeSummarySafe failed, falling back.",
        label || "",
        err,
      );
    }

    try {
      const normalized = normalizeWalletForSummary(wallet);
      const base = computeSummary({ events: normalized.events });
      return {
        userId: normalized.userId,
        v: normalized.v,
        total: base.total,
        unpaid: base.unpaid,
        credit: base.credit,
        perDay: base.perDay,
        eventsSorted: base.eventsSorted,
      };
    } catch (e) {
      logOnce(e, "normalize");
    }

    try {
      if (wallet && Array.isArray(wallet.events)) {
        const base = computeSummary(wallet);
        return {
          userId,
          v,
          total: base.total,
          unpaid: base.unpaid,
          credit: base.credit,
          perDay: base.perDay,
          eventsSorted: base.eventsSorted,
        };
      }
    } catch (e) {
      logOnce(e, "legacy");
    }

    if (!didLog) {
      logOnce(new Error("summary fallback to zeros"), "empty");
    }

    return {
      userId,
      v,
      total: 0,
      unpaid: 0,
      credit: 0,
      perDay: [],
      eventsSorted: [],
    };
  }

  function parseDeleteRange(input, maxIndex) {
    const result = new Set();
    if (!input) return result;
    const parts = input
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (part.includes("-")) {
        const [startStr, endStr] = part.split("-").map((p) => p.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end)) continue;
        if (start < 1 || end < 1) continue;
        if (start > end) continue;
        for (let i = start; i <= end; i++) {
          if (i <= maxIndex) result.add(i);
        }
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= maxIndex) {
          result.add(n);
        }
      }
    }
    return result;
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

  window.dbWalletSummary = {
    todayDateStr,
    dateStrFromTimestamp,
    normalizeWalletForSummary,
    computeSummary,
    computeSummarySafe,
    parseDeleteRange,
    formatLogLine,
  };
})();
