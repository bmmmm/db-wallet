(function () {
  const helpers = window.dbWalletHelpers || null;
  const storage = window.dbWalletStorage || null;
  const summaryApi = window.dbWalletSummary || null;
  if (!helpers || !storage || !summaryApi) return;

  const {
    randomId,
    randomWalletId,
    safeLocalStorageRemoveItem,
    STORAGE_PREFIX,
  } = helpers;
  const { saveWallet, nextEventId, undoLastEvent, appendTombstone } = storage;
  const { dateStrFromTimestamp, parseDeleteRange } = summaryApi;

  function newEvent(wallet, type, n) {
    return {
      id: nextEventId(wallet),
      t: type,
      n: typeof n === "number" ? n : undefined,
      ts: Date.now(),
    };
  }

  function bookDrink(ctx) {
    const wallet = ctx.getWallet();
    wallet.events.push(newEvent(wallet, "d", ctx.getAmount()));
    saveWallet(wallet);
    ctx.resetAmount();
    ctx.onStateChanged();
  }

  function undoLast(ctx) {
    const wallet = ctx.getWallet();
    const removed = undoLastEvent(wallet);
    if (!removed) {
      ctx.resetAmount();
      ctx.clearExport();
      return;
    }
    ctx.resetAmount();
    ctx.onStateChanged();
  }

  function payToday(ctx) {
    const wallet = ctx.getWallet();
    if (ctx.getSummary().unpaid <= 0) {
      ctx.dialogAlert("Keine offenen Getränke zum Bezahlen.");
      ctx.clearExport();
      return;
    }
    wallet.events.push(newEvent(wallet, "p"));
    saveWallet(wallet);
    ctx.resetAmount();
    ctx.resetPayUi();
    ctx.onStateChanged();
  }

  function bookCredit(ctx) {
    const wallet = ctx.getWallet();
    const amountStr = ctx.dialogPrompt(
      "Wie viele Getränke möchtest du als Guthaben buchen?",
      "10",
    );
    if (amountStr === null) {
      ctx.clearExport();
      return;
    }
    const n = parseInt(amountStr, 10);
    if (isNaN(n) || n <= 0) {
      ctx.dialogAlert("Ungültige Menge für die Gutschrift.");
      ctx.clearExport();
      return;
    }
    wallet.events.push(newEvent(wallet, "g", n));
    saveWallet(wallet);
    ctx.resetAmount();
    ctx.resetPayUi();
    ctx.onStateChanged();
  }

  function resetWallet(ctx) {
    const wallet = ctx.getWallet();
    const userId = ctx.getUserId();
    if (
      !ctx.dialogConfirm(`Wirklich alle Getränkedaten für "${userId}" löschen? 🗑️`)
    ) {
      return;
    }
    safeLocalStorageRemoveItem(STORAGE_PREFIX + wallet.userId);
    if (
      typeof wallet.userId === "string" &&
      wallet.userId &&
      !wallet.userId.includes(":")
    ) {
      safeLocalStorageRemoveItem(wallet.userId);
    }
    const next = {
      userId: wallet.userId,
      walletId: wallet.walletId || randomWalletId(),
      deviceId: wallet.deviceId || randomId(),
      v: 2,
      seq: {},
      events: [],
      actionCodes: [],
    };
    saveWallet(next);
    ctx.setWallet(next);
    ctx.refreshActionCodesUi();
    ctx.clearExport();
    ctx.setHistoryEmpty();
    ctx.clearDeleteRange();
    ctx.resetAmount();
    ctx.updateHeaderUi();
    ctx.onStateChanged();
  }

  function deleteSelection(ctx) {
    const wallet = ctx.getWallet();
    const userId = ctx.getUserId();
    const summary = ctx.getSummary();
    const maxIndex = summary.eventsSorted.length;
    if (maxIndex === 0) {
      ctx.dialogAlert(`Keine Logeinträge für "${userId}" vorhanden.`);
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    const indices = parseDeleteRange(ctx.getDeleteRange(), maxIndex);
    if (!indices.size) {
      ctx.dialogAlert("Keine gültigen IDs im Eingabefeld gefunden.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    const idsToDelete = new Set();
    let payCount = 0;
    summary.eventsSorted.forEach((e, i) => {
      const idx = i + 1;
      if (indices.has(idx)) {
        if (!e || e.t === "x") return;
        idsToDelete.add(e.id);
        if (e.t === "p") payCount++;
      }
    });
    if (!idsToDelete.size) {
      ctx.dialogAlert("Keine passenden Logeinträge gefunden.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    let msg = `Wirklich ${idsToDelete.size} Logeintrag/Einträge für "${userId}" löschen? 🧹`;
    if (payCount > 0) {
      msg += `\nAchtung: Darunter sind ${payCount} Zahlung(en) 💸.`;
    }
    if (!ctx.dialogConfirm(msg)) return;

    // Stamp tombstones strictly after the newest known event so deletions always
    // sort last in the log, even if the target was future-dated via editEntry or
    // the device clock is skewed backward.
    let maxTs = Date.now();
    for (const e of wallet.events) {
      if (e && typeof e.ts === "number" && Number.isFinite(e.ts) && e.ts > maxTs) {
        maxTs = e.ts;
      }
    }
    const baseTs = maxTs + 1;
    let added = 0;
    for (const id of idsToDelete) {
      if (appendTombstone(wallet, id, baseTs + added)) {
        added++;
      }
    }
    if (added > 0) saveWallet(wallet);
    ctx.clearExport();
    ctx.clearDeleteRange();
    ctx.onStateChanged();
  }

  function editEntry(ctx) {
    const wallet = ctx.getWallet();
    const userId = ctx.getUserId();
    const summary = ctx.getSummary();
    const maxIndex = summary.eventsSorted.length;
    if (maxIndex === 0) {
      ctx.dialogAlert(`Keine Logeinträge für "${userId}" vorhanden.`);
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    const indices = parseDeleteRange(ctx.getDeleteRange(), maxIndex);
    if (!indices.size) {
      ctx.dialogAlert(
        "Bitte genau eine ID angeben, die bearbeitet werden soll.",
      );
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    if (indices.size > 1) {
      ctx.dialogAlert("Bearbeitung funktioniert nur mit genau einer ID.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    const targetIndex = Array.from(indices)[0];
    const targetEvent = summary.eventsSorted[targetIndex - 1];
    if (!targetEvent) {
      ctx.dialogAlert(
        "Die ausgewählte ID konnte keinem Logeintrag zugeordnet werden.",
      );
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    if (targetEvent.t === "x") {
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    const currentDateStr = dateStrFromTimestamp(targetEvent.ts);
    const newDateStr = ctx.dialogPrompt(
      `Neues Datum für Eintrag #${targetIndex} (YYYY-MM-DD):`,
      currentDateStr,
    );
    if (newDateStr === null) {
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateStr)) {
      ctx.dialogAlert("Ungültiges Datumsformat. Erwartet wird YYYY-MM-DD.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    const now = new Date();
    const parts = newDateStr.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const testDate = new Date(
      year,
      month,
      day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds(),
    );
    if (isNaN(testDate.getTime())) {
      ctx.dialogAlert("Ungültiges Datum.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }
    // Reject future dates: balance is computed in strict ts order and a future
    // ts would reorder the event past a "p" (pay), silently flipping paid drinks
    // back to unpaid (and vice versa).
    if (testDate.getTime() > Date.now()) {
      ctx.dialogAlert("Das Datum darf nicht in der Zukunft liegen.");
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    let newAmount = targetEvent.n;
    if (targetEvent.t !== "p") {
      const defaultAmount =
        typeof targetEvent.n === "number" ? targetEvent.n : 1;
      const amountStr = ctx.dialogPrompt(
        `Neue Menge für Eintrag #${targetIndex}:`,
        String(defaultAmount),
      );
      if (amountStr === null) {
        ctx.clearExport();
        ctx.clearDeleteRange();
        return;
      }
      const parsed = parseInt(amountStr, 10);
      if (isNaN(parsed) || parsed <= 0) {
        ctx.dialogAlert("Ungültige Menge.");
        ctx.clearExport();
        ctx.clearDeleteRange();
        return;
      }
      newAmount = parsed;
    }

    const newTs = testDate.getTime();
    const targetId = targetEvent.id;
    // Append-only edit: tombstone the original event and append a replacement
    // with a fresh id. Mutating the event in place keeps the same id, and the
    // cross-device merge dedups strictly by id — so an in-place edit silently
    // fails to propagate (or gets reverted) when two devices hold that id.
    appendTombstone(wallet, targetId);
    wallet.events.push({
      id: nextEventId(wallet),
      t: targetEvent.t,
      n: targetEvent.t === "p" ? undefined : newAmount,
      ts: newTs,
    });
    saveWallet(wallet);
    ctx.clearExport();
    ctx.clearDeleteRange();
    ctx.onStateChanged();
  }

  window.dbWalletActions = {
    bookDrink,
    undoLast,
    payToday,
    bookCredit,
    resetWallet,
    deleteSelection,
    editEntry,
  };
})();
