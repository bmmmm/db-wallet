(function () {
  const helpers = window.dbWalletHelpers || null;
  const storage = window.dbWalletStorage || null;
  const summaryApi = window.dbWalletSummary || null;
  if (!helpers || !storage || !summaryApi) return;

  const { randomId, randomWalletId, MAX_EVENT_AMOUNT } = helpers;
  const {
    saveWallet,
    newEvent,
    appendEvents,
    undoLastEvent,
    buildTombstoneEvent,
    resolveUndoTarget,
  } = storage;
  const { dateStrFromTimestamp } = summaryApi;

  // E5: limits of one booking (wallet.html's amount field has max="99").
  const LIMITS = Object.freeze({ drinkMax: 99, creditMax: 999, drinkConfirmFrom: 20 });
  const SAVE_FAILED_MESSAGE =
    "Speichern fehlgeschlagen — Aktion verworfen (Speicher voll oder blockiert).";

  const drinksText = (n) => `${n} ${n === 1 ? "Getränk" : "Getränke"}`;

  // The balance after a change, for the status line: "Offen: 4" or
  // "Guthaben: 7".
  function balanceText(ctx) {
    const summary = ctx.getSummary();
    if (summary && summary.credit > 0) return `Guthaben: ${summary.credit}`;
    return `Offen: ${summary ? summary.unpaid : 0}`;
  }

  // Success notices go to the status line (P4.1); errors keep going through
  // ctx.dialogAlert, which wallet-ui.js also routes there.
  function notify(ctx, text, opts) {
    if (typeof ctx.notify === "function") ctx.notify(text, opts);
  }

  // A refused save: after a reset in another tab only a reload helps (P1.9),
  // otherwise storage is full or blocked.
  function reportSaveFailure(ctx) {
    if (storage.getLastSaveError() === "replaced") {
      storage.notifyWalletReplaced();
      return;
    }
    ctx.dialogAlert(SAVE_FAILED_MESSAGE);
  }

  // The status line's "Rückgängig" after a booking.
  function undoAction(ctx, eventId) {
    const userId = ctx.getUserId();
    return { label: "Rückgängig", run: () => undoBooking(ctx, eventId, userId) };
  }

  // Removes exactly that booking (a tombstone on its id, which is its own
  // root), not the newest visible entry like undoLast: another tab may have
  // booked in between. A booking that is gone already stays gone.
  function undoBooking(ctx, eventId, userId) {
    if (ctx.getUserId() !== userId) {
      notify(ctx, "Inzwischen ist ein anderes Wallet offen — nichts geändert.");
      return false;
    }
    const wallet = ctx.getWallet();
    const sorted = wallet.events.slice().sort(helpers.compareEventsByTime);
    const live = summaryApi
      .applyTombstones(sorted)
      .effectiveEvents.some((e) => e && summaryApi.rootIdOf(e) === eventId);
    if (!live) {
      notify(ctx, "Diese Buchung ist schon entfernt.");
      return false;
    }
    if (!persistEvents(ctx, wallet, [buildTombstoneEvent(wallet, eventId)])) return false;
    ctx.onStateChanged();
    notify(ctx, `Buchung zurückgenommen · ${balanceText(ctx)}`);
    return true;
  }

  // Appends `events` and saves (storage.appendEvents rolls the append back on
  // a failed write); a failure is reported here. Returns true on success.
  function persistEvents(ctx, wallet, events) {
    if (appendEvents(wallet, events)) return true;
    reportSaveFailure(ctx);
    return false;
  }

  // Asks through ctx.dialogConfirm (wallet.html: the shared <dialog>, a
  // Promise; a ctx stub answers at once) and runs `run` on yes, `onNo`
  // otherwise. Returns their result, or a promise of it.
  function askThen(ctx, message, opts, run, onNo) {
    return helpers.whenConfirmed(ctx.dialogConfirm(message, opts), run, onNo);
  }

  // A whole positive number typed into a form field ("" or "2.5" are not).
  function parseCount(value) {
    const s = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(s)) return NaN;
    const n = parseInt(s, 10);
    return n > 0 ? n : NaN;
  }

  // How many drinks removing the entry `rootId` re-opens (> 0 only for a pay):
  // the whole edit chain goes, not just its root event — a replacement left
  // behind would keep the pay alive.
  function reopenedByRemoving(wallet, rootId) {
    const without = {
      events: wallet.events.filter((e) => e && summaryApi.rootIdOf(e) !== rootId),
    };
    return (
      summaryApi.computeSummarySafe(without).unpaid -
      summaryApi.computeSummarySafe(wallet).unpaid
    );
  }

  // The visible entry of a root id (the newest edit of it), or null when it
  // is deleted or unknown.
  function findEntry(wallet, rootId) {
    const sorted = (wallet.events || []).slice().sort(helpers.compareEventsByTime);
    return (
      summaryApi
        .applyTombstones(sorted)
        .effectiveEvents.find((e) => e && summaryApi.rootIdOf(e) === rootId) || null
    );
  }

  function bookDrink(ctx) {
    const n = ctx.getAmount();
    if (n > LIMITS.drinkMax) {
      ctx.dialogAlert(`Höchstens ${LIMITS.drinkMax} Getränke auf einmal.`);
      return false;
    }
    const book = () => {
      // Read the wallet only now: during the dialog another tab may have
      // replaced it (storage event).
      const wallet = ctx.getWallet();
      const event = newEvent(wallet, "d", n);
      if (!persistEvents(ctx, wallet, [event])) return false;
      ctx.resetAmount();
      ctx.onStateChanged();
      notify(ctx, `+${n} gebucht · ${balanceText(ctx)}`, {
        action: undoAction(ctx, event.id),
      });
      return true;
    };
    if (n >= LIMITS.drinkConfirmFrom) {
      return askThen(
        ctx,
        `Wirklich ${drinksText(n)} auf einmal buchen?`,
        { okLabel: "Buchen" },
        book,
        () => false,
      );
    }
    return book();
  }

  function undoLast(ctx) {
    const wallet = ctx.getWallet();
    const userId = ctx.getUserId();
    // Resolve what undoLastEvent will actually act on so any confirm matches the
    // outcome (undo is monotonic: it removes the last visible entry).
    const plan = resolveUndoTarget(wallet);
    let msg = null;
    if (plan) {
      if (plan.event && plan.event.t === "p") {
        // Undoing a pay re-opens the drinks it settled — confirm with the swing,
        // matching the warning a deleted pay row shows.
        const reopened = reopenedByRemoving(wallet, plan.id);
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
    }
    const run = (confirmed) => {
      const current = ctx.getWallet();
      let target = plan;
      if (confirmed) {
        // The answer came later: if the log changed meanwhile (another tab),
        // the confirmed entry may no longer be the one undo would hit.
        const now = resolveUndoTarget(current);
        if (ctx.getUserId() !== userId || !now || !plan || now.id !== plan.id) {
          notify(ctx, "Der Verlauf hat sich inzwischen geändert — nichts rückgängig gemacht.");
          return false;
        }
        target = now;
      }
      // Pass the already-resolved plan so undoLastEvent doesn't re-resolve it.
      const removed = undoLastEvent(current, target);
      if (removed && removed.status === "failed") {
        // A real save failure (quota / blocked storage / reset elsewhere) —
        // surface it instead of failing silently like an empty log.
        reportSaveFailure(ctx);
        ctx.resetAmount();
        ctx.clearExport();
        return false;
      }
      if (!removed) {
        notify(ctx, "Nichts zum Rückgängigmachen.");
        ctx.resetAmount();
        ctx.clearExport();
        return false;
      }
      ctx.resetAmount();
      ctx.onStateChanged();
      const ev = target && target.event;
      const what =
        !ev || ev.t === "p"
          ? "Bezahlung"
          : ev.t === "g"
            ? `Guthaben +${ev.n}`
            : `+${drinksText(ev.n)}`;
      notify(ctx, `Rückgängig: ${what} entfernt · ${balanceText(ctx)}`);
      return true;
    };
    if (msg) {
      return askThen(ctx, msg, { okLabel: "Fortfahren" }, () => run(true), () => {
        ctx.clearExport();
        return false;
      });
    }
    return run(false);
  }

  // Settles every open drink (not only today's; the button says so).
  function payToday(ctx) {
    const wallet = ctx.getWallet();
    const open = ctx.getSummary().unpaid;
    if (open <= 0) {
      ctx.dialogAlert("Keine offenen Getränke zum Bezahlen.");
      ctx.clearExport();
      return false;
    }
    const event = newEvent(wallet, "p");
    if (!persistEvents(ctx, wallet, [event])) return false;
    ctx.resetAmount();
    ctx.resetPayUi();
    ctx.onStateChanged();
    notify(ctx, `${drinksText(open)} bezahlt · ${balanceText(ctx)}`, {
      action: undoAction(ctx, event.id),
    });
    return true;
  }

  // P4.3: the amount comes from the credit form (#credit-amount). Returns
  // true when booked; on false the form stays open with the error shown.
  function bookCredit(ctx, amountValue) {
    const n = parseCount(amountValue);
    if (!n) {
      ctx.dialogAlert("Ungültige Menge für die Gutschrift.");
      return false;
    }
    if (n > LIMITS.creditMax) {
      ctx.dialogAlert(`Höchstens ${LIMITS.creditMax} Getränke Guthaben auf einmal.`);
      return false;
    }
    const wallet = ctx.getWallet();
    const event = newEvent(wallet, "g", n);
    if (!persistEvents(ctx, wallet, [event])) return false;
    ctx.resetAmount();
    ctx.resetPayUi();
    ctx.onStateChanged();
    notify(ctx, `Guthaben +${n} gebucht · ${balanceText(ctx)}`, {
      action: undoAction(ctx, event.id),
    });
    return true;
  }

  function resetWallet(ctx) {
    const userId = ctx.getUserId();
    return askThen(
      ctx,
      `Wirklich alle Getränkedaten für „${userId}“ löschen? 🗑️`,
      { okLabel: "Alles löschen", danger: true },
      () => {
        if (ctx.getUserId() !== userId) {
          notify(ctx, "Inzwischen ist ein anderes Wallet offen — nichts geändert.");
          return false;
        }
        return doReset(ctx, ctx.getWallet(), userId);
      },
      () => false,
    );
  }

  function doReset(ctx, wallet, userId) {
    // Reset = a new wallet under the same name (E2): a fresh walletId, so an
    // export taken before the reset no longer merges into it (it imports as a
    // separate wallet) and local action-code QRs bound to the old walletId stop
    // working. The per-device seq counters carry over (bumped past every old
    // event first), so no event id is ever re-issued — another device or an
    // old export can't confuse a new booking with a deleted one.
    storage.ensureDeviceSeq(wallet);
    const seq = Object.assign({}, wallet.seq || {});
    const next = {
      userId: wallet.userId,
      walletId: randomWalletId(),
      deviceId: wallet.deviceId || randomId(),
      v: 2,
      seq,
      events: [],
      actionCodes: [],
      globalActionCodes: [],
    };
    // The only intentional walletId switch: saveWallet refuses a walletId that
    // differs from the persisted one unless told so (stale-tab guard, P1.9),
    // and with the flag it overwrites without reconciling. The stored wallet
    // is replaced, never removed first: if the write fails (storage full) the
    // old wallet stays both on disk and in this tab.
    if (!saveWallet(next, { allowWalletIdChange: true, quiet: true })) {
      ctx.dialogAlert(
        "Zurücksetzen fehlgeschlagen: Speichern nicht möglich (Speicher voll oder blockiert). Das Wallet ist unverändert.",
      );
      return false;
    }
    ctx.setWallet(next);
    ctx.refreshActionCodesUi();
    ctx.clearExport();
    ctx.resetAmount();
    ctx.updateHeaderUi();
    ctx.onStateChanged();
    notify(ctx, `Alle Daten für „${userId}“ gelöscht.`);
    return true;
  }

  // P4.4: deletes one history entry by its root id (the row's target, not a
  // typed position): a tombstone on the root, so the delete covers every edit
  // of it and wins over a concurrent edit elsewhere.
  function deleteEntry(ctx, rootId) {
    const userId = ctx.getUserId();
    const wallet = ctx.getWallet();
    const entry = findEntry(wallet, rootId);
    if (!entry) {
      notify(ctx, "Dieser Eintrag ist schon entfernt.");
      return false;
    }
    let msg = `Eintrag löschen: ${summaryApi.formatEntryText(entry)}?`;
    if (entry.t === "p") {
      const reopened = reopenedByRemoving(wallet, rootId);
      msg +=
        reopened > 0
          ? `\nDas ist eine Bezahlung: danach sind ${drinksText(reopened)} wieder offen. 💸`
          : "\nDas ist eine Bezahlung. 💸";
    }
    return askThen(
      ctx,
      msg,
      { okLabel: "Löschen", danger: true },
      () => {
        const current = ctx.getWallet();
        if (ctx.getUserId() !== userId) {
          notify(ctx, "Inzwischen ist ein anderes Wallet offen — nichts geändert.");
          return false;
        }
        if (!findEntry(current, rootId)) {
          notify(ctx, "Dieser Eintrag ist schon entfernt.");
          return false;
        }
        if (!persistEvents(ctx, current, [buildTombstoneEvent(current, rootId)])) return false;
        ctx.clearExport();
        ctx.onStateChanged();
        notify(ctx, `Eintrag gelöscht · ${balanceText(ctx)}`);
        return true;
      },
      () => false,
    );
  }

  // P4.3/P4.4: edits one entry from the row's form: values.date
  // ("YYYY-MM-DD", from <input type="date">) and values.amount (not for a
  // pay). Returns true when saved (or nothing changed); on false the form
  // stays open and the error is shown.
  function editEntry(ctx, rootId, values) {
    const wallet = ctx.getWallet();
    const target = findEntry(wallet, rootId);
    if (!target) {
      ctx.dialogAlert("Dieser Eintrag ist nicht mehr vorhanden.");
      return false;
    }
    const v = values || {};
    const dateStr = String(v.date == null ? "" : v.date).trim();
    if (!dateStr) {
      ctx.dialogAlert("Bitte ein Datum wählen.");
      return false;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) {
      ctx.dialogAlert("Ungültiges Datum.");
      return false;
    }

    // The same day keeps the exact timestamp (an amount-only edit never
    // moves the entry); another day keeps the time of day.
    let newTs = target.ts;
    if (dateStr !== dateStrFromTimestamp(target.ts)) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      const orig = new Date(target.ts);
      const moved = new Date(
        year,
        month,
        day,
        orig.getHours(),
        orig.getMinutes(),
        orig.getSeconds(),
        orig.getMilliseconds(),
      );
      // new Date(2024, 12, 45) silently rolls over; reject anything that
      // does not round-trip to the parsed components.
      if (
        isNaN(moved.getTime()) ||
        moved.getFullYear() !== year ||
        moved.getMonth() !== month ||
        moved.getDate() !== day
      ) {
        ctx.dialogAlert("Ungültiges Datum.");
        return false;
      }
      newTs = moved.getTime();
      const now = Date.now();
      if (newTs > now) {
        // Today at a later time of day than now becomes "now"; a later day
        // is refused: balance is folded in ts order, and a future ts would
        // reorder the entry past a later pay.
        if (dateStr !== summaryApi.todayDateStr()) {
          ctx.dialogAlert("Das Datum darf nicht in der Zukunft liegen.");
          return false;
        }
        newTs = now;
      }
    }

    // Reject moving the entry across a pay ("p") boundary in EITHER direction.
    // Balance is folded in strict ts order and a pay clamps it to 0, so
    // relocating an event to the other side of a pay silently re-settles it
    // (flips paid<->unpaid). A move within the same inter-pay segment is purely
    // additive and leaves unpaid/credit untouched; if a same-amount move at the
    // new ts changes them, the new date crossed a pay.
    //
    // Drop the WHOLE root chain (not just the visible id) and give the probe
    // event supersedes=root, otherwise an earlier replacement of the same entry
    // would resurface and double-count, falsely rejecting every chain edit.
    if (newTs !== target.ts) {
      const movedSameAmount = {
        events: wallet.events
          .filter((e) => e && summaryApi.rootIdOf(e) !== rootId)
          .concat([
            {
              id: target.id + ".edit-probe",
              t: target.t,
              n: target.t === "p" ? undefined : target.n,
              ts: newTs,
              supersedes: rootId,
            },
          ]),
      };
      // Compare both sides through the same code path (computeSummarySafe) so
      // normalization can't fabricate a spurious diff.
      const baseline = summaryApi.computeSummarySafe(wallet);
      const probe = summaryApi.computeSummarySafe(movedSameAmount);
      if (probe.unpaid !== baseline.unpaid || probe.credit !== baseline.credit) {
        ctx.dialogAlert(
          "Das neue Datum verschiebt den Eintrag über eine Bezahlung hinweg und würde bezahlte/offene Getränke verändern. Bearbeitung abgebrochen.",
        );
        return false;
      }
    }

    let newAmount;
    if (target.t !== "p") {
      const parsed = parseCount(v.amount);
      if (!parsed) {
        ctx.dialogAlert("Ungültige Menge.");
        return false;
      }
      // The same limits as a new booking (E5).
      const limit =
        target.t === "d" ? LIMITS.drinkMax : target.t === "g" ? LIMITS.creditMax : 0;
      if (limit && parsed > limit) {
        ctx.dialogAlert(
          target.t === "d"
            ? `Höchstens ${limit} Getränke auf einmal.`
            : `Höchstens ${limit} Getränke Guthaben auf einmal.`,
        );
        return false;
      }
      newAmount = Math.min(parsed, MAX_EVENT_AMOUNT);
    }
    if (newTs === target.ts && (target.t === "p" || newAmount === target.n)) {
      notify(ctx, "Keine Änderung.");
      return true;
    }

    // Append-only, merge-safe edit: a replacement carrying supersedes=<root>.
    // The summary fold collapses every replacement of one root to the latest
    // edit (helpers.compareEdits: the highest seq; newEvent lifts it above the
    // chain), so two devices editing the same entry offline converge instead
    // of double-counting. No tombstone: the replacement supersedes the
    // original (and any earlier replacement) directly.
    const ev = newEvent(wallet, target.t, newAmount, { supersedes: rootId });
    ev.ts = newTs;
    if (!persistEvents(ctx, wallet, [ev])) return false;
    ctx.clearExport();
    ctx.onStateChanged();
    notify(ctx, `Eintrag geändert · ${balanceText(ctx)}`);
    return true;
  }

  window.dbWalletActions = {
    LIMITS,
    bookDrink,
    undoLast,
    payToday,
    bookCredit,
    resetWallet,
    deleteEntry,
    editEntry,
  };
})();
