(function () {
  function cmpStr(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  // Tie-break for equal-timestamp events; delegates to the canonical comparator
  // in helpers (deviceKey lexical, seq numeric). Lexical fallback only if helpers
  // failed to load — in practice it is always present (loaded first).
  function cmpEventId(a, b) {
    const helpers = window.dbWalletHelpers || null;
    if (helpers && typeof helpers.cmpEventId === "function") {
      return helpers.cmpEventId(a, b);
    }
    return cmpStr(a, b);
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

  // The chain root of an event: an edit replacement carries supersedes=<rootId>,
  // so all replacements of one logical entry share a root. An un-edited event is
  // its own root.
  function rootIdOf(e) {
    if (e && typeof e.supersedes === "string" && e.supersedes) {
      return e.supersedes;
    }
    return e && typeof e.id === "string" ? e.id : "";
  }

  function applyTombstones(events) {
    const helpers = window.dbWalletHelpers || null;
    const cmp =
      helpers && typeof helpers.compareEventsByTime === "function"
        ? helpers.compareEventsByTime
        : null;
    const list = Array.isArray(events) ? events : [];

    const tombstones = [];
    const tombstoneById = new Map();
    const nonTombstone = [];
    const membersByRoot = new Map();
    const idToRoot = new Map();

    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      if (e.t === "x") {
        tombstones.push(e);
        if (typeof e.id === "string" && e.id) tombstoneById.set(e.id, e);
        continue;
      }
      nonTombstone.push(e);
      const root = rootIdOf(e);
      if (typeof e.id === "string" && e.id) idToRoot.set(e.id, root);
      if (!membersByRoot.has(root)) membersByRoot.set(root, []);
      membersByRoot.get(root).push(e);
    }

    // A tombstone whose own id is referenced by another tombstone has been
    // "undone" (undo-of-delete): it no longer suppresses its target.
    const neutralized = new Set();
    for (const e of tombstones) {
      const ref = typeof e.ref === "string" ? e.ref.trim() : "";
      if (ref && tombstoneById.has(ref)) neutralized.add(ref);
    }

    // A delete tombstone refs the entry's ROOT (legacy tombstones may ref a
    // replacement id, so resolve through idToRoot). Deleting a root suppresses
    // the whole logical entry — every replacement of it — so a concurrent edit
    // can't resurrect a deleted entry. Orphan refs (no member with that root)
    // suppress nothing.
    const deletedRoots = new Set();
    for (const e of tombstones) {
      if (typeof e.id === "string" && neutralized.has(e.id)) continue;
      const ref = typeof e.ref === "string" ? e.ref.trim() : "";
      if (!ref) continue;
      if (tombstoneById.has(ref)) continue; // targets a tombstone -> neutralization
      const root = idToRoot.has(ref) ? idToRoot.get(ref) : ref;
      if (membersByRoot.has(root)) deletedRoots.add(root);
    }

    // Winner per root: the canonical-last replacement if any edit happened,
    // else the bare root event. Two devices editing the same root independently
    // therefore collapse to ONE deterministic survivor on every device.
    const winnerByRoot = new Map();
    for (const [root, members] of membersByRoot) {
      const reps = members.filter(
        (m) => typeof m.supersedes === "string" && m.supersedes,
      );
      const pool = reps.length ? reps : members;
      let winner = pool[0];
      for (let i = 1; i < pool.length; i++) {
        const better = cmp
          ? cmp(pool[i], winner) > 0
          : (pool[i].ts || 0) > (winner.ts || 0) ||
            ((pool[i].ts || 0) === (winner.ts || 0) &&
              String(pool[i].id) > String(winner.id));
        if (better) winner = pool[i];
      }
      winnerByRoot.set(root, winner);
    }

    const deletedIds = new Set();
    const visibleEvents = [];
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      if (e.t === "x") {
        visibleEvents.push(e);
        continue;
      }
      const root = rootIdOf(e);
      if (deletedRoots.has(root)) {
        if (typeof e.id === "string" && e.id) deletedIds.add(e.id);
        continue;
      }
      const winner = winnerByRoot.get(root);
      if (winner && e !== winner) {
        // superseded by a newer edit of the same entry
        if (typeof e.id === "string" && e.id) deletedIds.add(e.id);
        continue;
      }
      visibleEvents.push(e);
    }

    const effectiveEvents = visibleEvents.filter((e) => e.t !== "x");

    return {
      deletedIds,
      tombstones,
      neutralized,
      deletedRoots,
      visibleEvents,
      effectiveEvents,
    };
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
      const ref =
        typeof ev.ref === "string" && ev.ref.trim() !== "" ? ev.ref : undefined;
      const supersedes =
        typeof ev.supersedes === "string" && ev.supersedes.trim() !== ""
          ? ev.supersedes
          : undefined;
      events.push({ id, t, n, ts, ref, supersedes });
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
      .sort((a, b) => a.ts - b.ts || cmpEventId(a.id, b.id));
    const tombstoneRes = applyTombstones(eventsSorted);
    const eventsEffective = tombstoneRes.effectiveEvents;
    const eventsVisible = tombstoneRes.visibleEvents;

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

    for (const e of eventsEffective) {
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
        // 's' (subtract) is import/legacy only — the action layer never produces
        // it (undo/delete/edit use tombstones t:"x"). It removes unpaid drinks
        // but must NOT manufacture credit: if subtracting would push a
        // non-negative balance below zero, clamp at zero so a stray/crafted 's'
        // can't surface as phantom Guthaben (the symmetric counterpart to the
        // `total < 0` clamp below).
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        const balanceBefore = balance;
        total -= n;
        day.drinks -= n;
        // Keep drinkCount (the bracketed label) net so it agrees with the bar,
        // which is drawn from day.drinks; otherwise an undone day shows e.g. "[3]"
        // with a shorter/empty bar.
        day.drinkCount -= n;
        balance -= n;
        if (balanceBefore >= 0 && balance < 0) balance = 0;
      } else if (e.t === "p") {
        // day.paid flags that a payment occurred ON this day — it does not mark
        // the earlier days this pay settles. The actual settlement is the global
        // balance clamp below.
        day.paid = true;
        if (balance > 0) {
          balance = 0;
        }
      } else if (e.t === "g") {
        const n =
          typeof e.n === "number" && isFinite(e.n)
            ? Math.max(1, Math.round(e.n))
            : 1;
        // Gutschriften offset the balance (credit) but deliberately do NOT touch
        // total or the per-day drink count — credit is not drink consumption.
        // Do not "symmetrize" the d/s/g branches: that would double-count.
        balance -= n;
      }
    }

    for (const d of perDayMap.values()) {
      if (d.drinks < 0) d.drinks = 0;
      if (d.drinkCount < 0) d.drinkCount = 0;
    }
    if (total < 0) total = 0;

    const unpaid = Math.max(balance, 0);
    const credit = Math.max(-balance, 0);

    const perDay = Array.from(perDayMap.values()).sort((a, b) =>
      cmpStr(a.date, b.date),
    );

    return {
      total,
      unpaid,
      credit,
      perDay,
      eventsSorted: eventsVisible,
      eventsEffectiveSorted: eventsEffective,
    };
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
        eventsEffectiveSorted: base.eventsEffectiveSorted,
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
          eventsEffectiveSorted: base.eventsEffectiveSorted,
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
      eventsEffectiveSorted: [],
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
        // Cap the loop bound at maxIndex — a fat-finger like "1-99999999" would
        // otherwise spin the loop tens of millions of times and freeze the tab,
        // since the in-loop `i <= maxIndex` guard limited only what got added.
        const cappedEnd = Math.min(end, maxIndex);
        for (let i = start; i <= cappedEnd; i++) {
          result.add(i);
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
    else if (e.t === "x") {
      const ref = typeof e.ref === "string" ? e.ref : "";
      action = ref
        ? `🗑️ gelöscht: ${ref} (nicht bearbeitbar)`
        : "🗑️ gelöscht (nicht bearbeitbar)";
    }
    return `#${index} | ${dateStr} ${timeStr} | ${action}`;
  }

  window.dbWalletSummary = {
    todayDateStr,
    dateStrFromTimestamp,
    normalizeWalletForSummary,
    rootIdOf,
    applyTombstones,
    computeSummary,
    computeSummarySafe,
    parseDeleteRange,
    formatLogLine,
  };
})();
