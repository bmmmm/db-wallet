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
  const {
    saveWallet,
    nextEventId,
    newEvent,
    appendEvents,
    undoLastEvent,
    appendTombstone,
    resolveUndoTarget,
  } = storage;
  const { dateStrFromTimestamp, parseDeleteRange } = summaryApi;

  // Persist a wallet mutation, rolling back the optimistic in-memory append when
  // the write fails (quota exceeded / disabled storage). Returns true on success.
  // `mutate` must only APPEND events. Built on storage.appendEvents: we capture
  // exactly the events `mutate` appended, restore the pre-mutation array, then let
  // appendEvents snapshot + push + save + roll back atomically. This keeps the
  // dialog/alert here in the UI layer while the save/rollback lives in storage.
  function persistMutation(ctx, wallet, mutate) {
    const before = Array.isArray(wallet.events) ? wallet.events.slice() : [];
    mutate();
    const appended = wallet.events.slice(before.length);
    wallet.events = before;
    if (appendEvents(wallet, appended)) return true;
    ctx.dialogAlert(
      "Speichern fehlgeschlagen — Aktion verworfen (Speicher voll oder blockiert).",
    );
    return false;
  }

  function bookDrink(ctx) {
    const wallet = ctx.getWallet();
    const ok = persistMutation(ctx, wallet, () => {
      wallet.events.push(newEvent(wallet, "d", ctx.getAmount()));
    });
    if (!ok) return;
    ctx.resetAmount();
    ctx.onStateChanged();
  }

  function undoLast(ctx) {
    const wallet = ctx.getWallet();
    // Resolve what undoLastEvent will actually act on so any confirm matches the
    // outcome (undo is monotonic: it removes the last visible entry).
    const plan = resolveUndoTarget ? resolveUndoTarget(wallet) : null;
    if (plan) {
      let msg = null;
      if (plan.event && plan.event.t === "p") {
        // Undoing a pay re-opens the drinks it settled — confirm with the swing,
        // matching the count warning deleteSelection already shows for pays.
        const without = {
          events: wallet.events.filter((e) => e && e.id !== plan.id),
        };
        const baseline = summaryApi.computeSummarySafe(wallet);
        const reopened =
          summaryApi.computeSummarySafe(without).unpaid - baseline.unpaid;
        msg =
          reopened > 0
            ? `Dies nimmt die letzte Bezahlung zurück und öffnet ${reopened} Getränk(e) wieder. Fortfahren? 💸`
            : "Dies nimmt die letzte Bezahlung zurück. Fortfahren? 💸";
      } else if (plan.afterDeletion) {
        // The previous action was a deletion. Undo does NOT revert the deletion
        // — it removes the newest still-visible entry — so make that explicit
        // instead of silently retargeting.
        msg =
          "Die letzte Aktion war eine Löschung. „Rückgängig“ nimmt nicht die Löschung zurück, sondern den neuesten noch sichtbaren Eintrag. Fortfahren?";
      }
      if (msg && !ctx.dialogConfirm(msg)) {
        ctx.clearExport();
        return;
      }
    }
    // Pass the already-resolved plan so undoLastEvent doesn't re-resolve it.
    const removed = undoLastEvent(wallet, plan);
    if (removed && removed.status === "failed") {
      // A real save failure (quota / blocked storage) — surface it instead of
      // failing silently like an empty log. Mirror persistMutation's wording.
      ctx.dialogAlert(
        "Speichern fehlgeschlagen — Aktion verworfen (Speicher voll oder blockiert).",
      );
      ctx.resetAmount();
      ctx.clearExport();
      return;
    }
    if (!removed) {
      // Nothing to undo — keep today's silent behavior.
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
    const ok = persistMutation(ctx, wallet, () => {
      wallet.events.push(newEvent(wallet, "p"));
    });
    if (!ok) return;
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
    const ok = persistMutation(ctx, wallet, () => {
      wallet.events.push(newEvent(wallet, "g", n));
    });
    if (!ok) return;
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
    let skippedTombstones = 0;
    summary.eventsSorted.forEach((e, i) => {
      const idx = i + 1;
      if (indices.has(idx)) {
        if (!e || e.t === "x") {
          if (e && e.t === "x") skippedTombstones++;
          return;
        }
        // Tombstone the entry's ROOT, not the visible replacement id, so a
        // delete kills the whole logical entry and wins over any concurrent edit.
        idsToDelete.add(summaryApi.rootIdOf(e));
        if (e.t === "p") payCount++;
      }
    });
    if (!idsToDelete.size) {
      // Distinguish "selection hit only already-deleted rows" from "no valid IDs"
      // so the message is actionable instead of generically blaming the input.
      ctx.dialogAlert(
        skippedTombstones > 0
          ? "Die Auswahl enthält nur Löscheinträge — diese sind bereits gelöscht und nicht erneut löschbar."
          : "Keine passenden Logeinträge gefunden.",
      );
      ctx.clearExport();
      ctx.clearDeleteRange();
      return;
    }

    let msg = `Wirklich ${idsToDelete.size} Logeintrag/Einträge für "${userId}" löschen? 🧹`;
    if (payCount > 0) {
      msg += `\nAchtung: Darunter sind ${payCount} Zahlung(en) 💸.`;
    }
    if (!ctx.dialogConfirm(msg)) return;

    // Tombstones are stamped strictly after the newest event by buildTombstoneEvent
    // (default ts = max(now, maxEventTs + 1)); each one pushed here raises the max
    // so successive deletions keep incrementing and sort last, in order.
    const ok = persistMutation(ctx, wallet, () => {
      for (const id of idsToDelete) {
        appendTombstone(wallet, id);
      }
    });
    if (!ok) return;
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
      ctx.dialogAlert(
        "Dieser Eintrag ist eine Löschung und kann nicht bearbeitet werden.",
      );
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
    // The regex only checks the shape — new Date(2024, 12, 45) silently rolls
    // over into the next month/year. Reject any input the Date constructor did
    // not round-trip back to the exact parsed components.
    if (
      isNaN(testDate.getTime()) ||
      testDate.getFullYear() !== year ||
      testDate.getMonth() !== month ||
      testDate.getDate() !== day
    ) {
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

    const newTs = testDate.getTime();
    const targetId = targetEvent.id;
    // The entry's root: when editing an already-edited entry, the target is a
    // replacement carrying supersedes, so resolve to the chain root.
    const probeRootId = summaryApi.rootIdOf(targetEvent);

    // Reject moving the entry across a pay ("p") boundary in EITHER direction.
    // Balance is folded in strict ts order and a pay clamps it to 0, so
    // relocating an event to the other side of a pay silently re-settles it
    // (flips paid<->unpaid). A move within the same inter-pay segment is purely
    // additive and leaves unpaid/credit untouched; if a same-amount move at the
    // new ts changes them, the new date crossed a pay. (The future guard above
    // only blocks one direction; this also blocks back-dating before an earlier
    // pay, which would zero a drink's unpaid contribution.)
    //
    // Drop the WHOLE root chain (not just the visible id) and give the probe
    // event supersedes=root, otherwise an earlier replacement of the same entry
    // would resurface and double-count, falsely rejecting every chain edit.
    const movedSameAmount = {
      events: wallet.events
        .filter((e) => e && summaryApi.rootIdOf(e) !== probeRootId)
        .concat([
          {
            id: targetId + ".edit-probe",
            t: targetEvent.t,
            n: targetEvent.t === "p" ? undefined : targetEvent.n,
            ts: newTs,
            supersedes: probeRootId,
          },
        ]),
    };
    // Compare both sides through the same code path (computeSummarySafe) so
    // normalization can't fabricate a spurious diff against the cached raw
    // summary.
    const baseline = summaryApi.computeSummarySafe(wallet);
    const probe = summaryApi.computeSummarySafe(movedSameAmount);
    if (probe.unpaid !== baseline.unpaid || probe.credit !== baseline.credit) {
      ctx.dialogAlert(
        "Das neue Datum verschiebt den Eintrag über eine Bezahlung hinweg und würde bezahlte/offene Getränke verändern. Bearbeitung abgebrochen.",
      );
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

    // Append-only, merge-safe edit: append a replacement carrying
    // supersedes=<rootId>. The summary fold collapses every replacement of one
    // root to the canonical-last winner, so two devices editing the same entry
    // offline converge to a single survivor instead of double-counting. No
    // tombstone is appended — the replacement supersedes the original (and any
    // earlier replacement) directly. Editing an already-edited entry keeps
    // pointing at the chain root so the chain collapses cleanly.
    const rootId = summaryApi.rootIdOf(targetEvent);
    const ok = persistMutation(ctx, wallet, () => {
      wallet.events.push({
        id: nextEventId(wallet),
        t: targetEvent.t,
        n: targetEvent.t === "p" ? undefined : newAmount,
        ts: newTs,
        supersedes: rootId,
      });
    });
    if (!ok) return;
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
