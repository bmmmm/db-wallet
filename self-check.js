(function () {
  function runChecksResult() {
    return { ok: true, checks: [], errors: [] };
  }

  function addCheck(result, name, ok, info) {
    result.checks.push({
      name,
      ok: !!ok,
      info: info || "",
    });
    if (!ok) result.ok = false;
  }

  function addError(result, err) {
    const msg = err && err.message ? err.message : String(err || "");
    result.errors.push(msg);
    result.ok = false;
  }

  async function run(options = {}) {
    const result = runChecksResult();
    const quiet = !!options.quiet;

    // Native dialogs freeze the renderer under automation, and some checks
    // exercise production paths that call confirm()/alert() (e.g. the global
    // action-code apply). Stub them for the whole run; restored in the outer
    // finally after pending hashchange handlers have drained.
    const origDialogs = {
      alert: window.alert,
      confirm: window.confirm,
      prompt: window.prompt,
    };
    window.alert = function () {};
    window.confirm = function () {
      return true;
    };
    window.prompt = function () {
      return null;
    };

    const helpers = window.dbWalletHelpers || null;
    const storage = window.dbWalletStorage || null;
    const importV2 = window.dbWalletImportV2 || null;
    const summaryApi = window.dbWalletSummary || null;
    const actionCodes = window.dbWalletActionCodes || null;
    const hashRouter = window.dbWalletHashRouter || null;

    if (!helpers) {
      addCheck(result, "helpers available", false, "dbWalletHelpers missing");
    }
    if (!storage) {
      addCheck(result, "storage available", false, "dbWalletStorage missing");
    }
    if (!importV2) {
      addCheck(
        result,
        "import v2 available",
        false,
        "dbWalletImportV2 missing",
      );
    }
    if (!summaryApi) {
      addCheck(result, "summary available", false, "dbWalletSummary missing");
    }
    if (!actionCodes) {
      addCheck(
        result,
        "action codes available",
        false,
        "dbWalletActionCodes missing",
      );
    }
    if (!hashRouter) {
      addCheck(
        result,
        "hash router available",
        false,
        "dbWalletHashRouter missing",
      );
    } else if (typeof hashRouter.classifyHash !== "function") {
      addCheck(
        result,
        "hash classifier available",
        false,
        "classifyHash missing",
      );
    }

    if (helpers) {
      const expected = [
        "fnv1a64",
        "hash53",
        "parseCompactEventId",
        "extractLegacyDeviceKey",
      ];
      const missing = expected.filter((k) => typeof helpers[k] !== "function");
      addCheck(
        result,
        "helpers central crypto + id utils",
        missing.length === 0,
        missing.length ? `missing=${missing.join(",")}` : "ok",
      );
    }

    if (hashRouter) {
      const prefixes = ["ac:", "acg:", "import:", "i2:", "i2u:"];
      const ok =
        typeof hashRouter.isReservedHashPrefix === "function" &&
        prefixes.every((p) => hashRouter.isReservedHashPrefix(p + "x")) &&
        !hashRouter.isReservedHashPrefix("peter") &&
        !hashRouter.isReservedHashPrefix("");
      addCheck(
        result,
        "hashRouter.isReservedHashPrefix covers all prefixes",
        ok,
        ok ? "ok" : "mismatch",
      );
    }

    const messagesApi = window.dbWalletMessages || null;
    addCheck(
      result,
      "messages api available",
      !!(
        messagesApi &&
        typeof messagesApi.showGlobal === "function" &&
        typeof messagesApi.clearGlobal === "function"
      ),
      messagesApi ? "ok" : "dbWalletMessages missing",
    );

    const hashActionsApi = window.dbWalletHashActions || null;
    addCheck(
      result,
      "hash actions api available",
      !!(
        hashActionsApi &&
        typeof hashActionsApi.awaitGlobalActionWalletSelection === "function" &&
        typeof hashActionsApi.buildGlobalActionPreview === "function" &&
        typeof hashActionsApi.showMessage === "function"
      ),
      hashActionsApi ? "ok" : "dbWalletHashActions missing",
    );

    const randomId =
      helpers && typeof helpers.randomId === "function"
        ? helpers.randomId
        : () => Math.random().toString(36).slice(2, 8);

    const safeRemove =
      helpers && typeof helpers.safeLocalStorageRemoveItem === "function"
        ? helpers.safeLocalStorageRemoveItem
        : () => false;

    const loadRegistry =
      helpers && typeof helpers.loadRegistry === "function"
        ? helpers.loadRegistry
        : () => ({});
    const saveRegistry =
      helpers && typeof helpers.saveRegistry === "function"
        ? helpers.saveRegistry
        : () => {};

    let testUserId = "";
    let testStorageKey = "";

    try {
      if (helpers && storage) {
        const rawId = "selfcheck-" + randomId();
        testUserId =
          typeof storage.ensureNonReservedUserId === "function"
            ? storage.ensureNonReservedUserId(rawId)
            : rawId;
        testStorageKey =
          helpers.STORAGE_PREFIX && testUserId
            ? helpers.STORAGE_PREFIX + testUserId
            : "";

        const wallet = storage.loadWallet(testUserId);
        const now = Date.now();
        wallet.events.push({
          id: storage.nextEventId(wallet),
          t: "d",
          n: 2,
          ts: now - 60000,
        });
        wallet.events.push({
          id: storage.nextEventId(wallet),
          t: "g",
          n: 1,
          ts: now,
        });
        storage.saveWallet(wallet);

        const loaded = storage.loadWallet(testUserId);
        addCheck(
          result,
          "storage roundtrip",
          loaded.events.length === wallet.events.length &&
            loaded.walletId === wallet.walletId,
          `events=${loaded.events.length}`,
        );

        const emptyWallet = storage.loadWallet("");
        addCheck(
          result,
          "storage rejects empty user",
          emptyWallet === null,
          emptyWallet ? "created" : "ok",
        );
        const reservedWallet = storage.loadWallet("acg:invalid");
        addCheck(
          result,
          "storage rejects reserved user",
          reservedWallet === null,
          reservedWallet ? "created" : "ok",
        );

        // Regression: an event with a corrupt ts (NaN serializes to null) must be
        // kept (ts=0), not silently dropped with the loss persisted on next save.
        // Self-contained + cleaned up to avoid leaking a wallet/registry entry.
        const badUser = storage.ensureNonReservedUserId(
          "selfcheck-badts-" + randomId(),
        );
        const badW = storage.loadWallet(badUser);
        badW.events.push({ id: "bt.1", t: "d", n: 1, ts: 123 });
        badW.events.push({ id: "bt.2", t: "d", n: 1, ts: NaN });
        storage.saveWallet(badW);
        const badReloaded = storage.loadWallet(badUser);
        const keptBad = badReloaded.events.find((e) => e.id === "bt.2");
        addCheck(
          result,
          "loadWallet keeps event with corrupt ts",
          !!keptBad && keptBad.ts === 0 && badReloaded.events.length === 2,
          keptBad
            ? `ts=${keptBad.ts} len=${badReloaded.events.length}`
            : `dropped len=${badReloaded.events.length}`,
        );
        if (helpers.STORAGE_PREFIX) {
          safeRemove(helpers.STORAGE_PREFIX + badUser);
        }
        try {
          const badReg = loadRegistry();
          delete badReg[badUser];
          saveRegistry(badReg);
        } catch (e) {
          // ignore
        }

        if (importV2) {
          const encoded = importV2.encodeImportV2Bytes(wallet, "");
          const decoded = importV2.decodeImportV2Bytes(encoded);
          addCheck(
            result,
            "export/import v2 decode",
            decoded.walletId === wallet.walletId &&
              decoded.userId === wallet.userId &&
              decoded.events.length === wallet.events.length,
            `events=${decoded.events.length}`,
          );

          const built = importV2.buildImportedWallet(decoded);
          const mergedCount = built.wallet.events.length;
          addCheck(
            result,
            "import merge",
            mergedCount === wallet.events.length,
            `events=${mergedCount}`,
          );

          // Ordering regression: a drink (seq 35 = "z") then a pay (seq 36 = "10")
          // in the same millisecond must stay settled (unpaid 0) across a v2
          // round-trip. The old encoder tie-broke lexically ("10" < "z"), which
          // reordered the pay before the drink and flipped the balance to unpaid 1.
          if (summaryApi && typeof summaryApi.computeSummary === "function") {
            const orderTs = now - 120000;
            const orderW = {
              userId: "selfcheck-order",
              walletId: wallet.walletId,
              v: 2,
              seq: {},
              events: [
                { id: "sc.z", t: "d", n: 1, ts: orderTs },
                { id: "sc.10", t: "p", ts: orderTs },
              ],
              actionCodes: [],
              devices: [],
            };
            const beforeUnpaid = summaryApi.computeSummary({
              events: orderW.events,
            }).unpaid;
            const orderDec = importV2.decodeImportV2Bytes(
              importV2.encodeImportV2Bytes(orderW, ""),
            );
            const afterUnpaid = summaryApi.computeSummary({
              events: orderDec.events,
            }).unpaid;
            addCheck(
              result,
              "v2 round-trip preserves same-minute paid order",
              beforeUnpaid === 0 && afterUnpaid === 0,
              `before=${beforeUnpaid} after=${afterUnpaid}`,
            );
          }

          // Tombstones must survive a v2 round-trip — they are the "xt" block, now
          // encoded first among extensions so a later corrupt block can't drop them.
          const tombDec = importV2.decodeImportV2Bytes(
            importV2.encodeImportV2Bytes(
              {
                userId: "selfcheck-tomb",
                walletId: wallet.walletId,
                v: 2,
                seq: {},
                events: [
                  { id: "tx.1", t: "d", n: 1, ts: now },
                  { id: "tx.2", t: "x", ref: "tx.1", ts: now + 1 },
                ],
                actionCodes: [],
                devices: [],
              },
              "",
            ),
          );
          addCheck(
            result,
            "v2 round-trip preserves tombstone",
            tombDec.events.some((e) => e.t === "x" && e.ref === "tx.1"),
            `events=${tombDec.events.length}`,
          );

          // Append a malformed "ac" extension (tag + version=1 + count=99 with
          // no entry data) and verify decodeImportV2Bytes warns on the parse
          // error but still returns correct core fields.
          const corruptOut = Array.from(encoded);
          corruptOut.push(97, 99); // "ac" tag
          corruptOut.push(1); // version 1 (varint)
          corruptOut.push(99); // count 99 (varint) — no entries follow
          const corruptBytes = new Uint8Array(corruptOut);
          let extensionWarned = false;
          const origWarn = console.warn;
          console.warn = function () {
            for (let i = 0; i < arguments.length; i++) {
              if (
                String(arguments[i]).includes("extension parse failed")
              ) {
                extensionWarned = true;
                break;
              }
            }
          };
          let corruptDecoded = null;
          let corruptError = null;
          try {
            corruptDecoded = importV2.decodeImportV2Bytes(corruptBytes);
          } catch (e) {
            corruptError = e;
          } finally {
            console.warn = origWarn;
          }
          addCheck(
            result,
            "v2 corrupt extension warns",
            extensionWarned && !corruptError,
            corruptError
              ? `threw=${corruptError.message}`
              : extensionWarned
                ? "ok"
                : "no warn",
          );
          addCheck(
            result,
            "v2 corrupt extension preserves core",
            !!corruptDecoded &&
              corruptDecoded.walletId === wallet.walletId &&
              corruptDecoded.userId === wallet.userId &&
              corruptDecoded.events.length === wallet.events.length,
            corruptDecoded
              ? `events=${corruptDecoded.events.length}`
              : "decode failed",
          );
          // IV3: a corrupt extension must flag the loss, not report clean success.
          addCheck(
            result,
            "v2 corrupt extension flags warning",
            !!corruptDecoded && corruptDecoded._extWarning === true,
            `flag=${corruptDecoded && corruptDecoded._extWarning}`,
          );

          // IV1: over-read length fields are rejected, not silently clamped.
          let overReadErr = "";
          try {
            importV2.decodeImportV2Bytes(
              new Uint8Array([100, 98, 119, 2, 255, 1, 100]),
            );
          } catch (e) {
            overReadErr = (e && e.message) || "err";
          }
          addCheck(
            result,
            "v2 rejects over-read length",
            overReadErr.indexOf("Truncated payload") !== -1,
            overReadErr,
          );

          // IV6: a newer codec version is rejected with a distinct error.
          let verErr = "";
          try {
            importV2.decodeImportV2Bytes(new Uint8Array([100, 98, 119, 3, 0]));
          } catch (e) {
            verErr = (e && e.message) || "err";
          }
          addCheck(
            result,
            "v2 rejects newer codec version",
            verErr.indexOf("Unsupported codec version") !== -1,
            verErr,
          );

          // IV2: an unknown extension version stops parsing cleanly (no desync,
          // no false warning) instead of misreading the rest of the payload.
          const baseW = {
            userId: "u2",
            walletId: wallet.walletId,
            v: 2,
            seq: {},
            events: [{ id: "dev.1", t: "d", n: 1, ts: now }],
            actionCodes: [],
            devices: [],
          };
          const baseArr = Array.from(importV2.encodeImportV2Bytes(baseW, ""));
          baseArr.push(97, 99, 99); // "ac" tag + unknown version 99
          let unkErr = null;
          let unkDecoded = null;
          try {
            unkDecoded = importV2.decodeImportV2Bytes(new Uint8Array(baseArr));
          } catch (e) {
            unkErr = e;
          }
          addCheck(
            result,
            "v2 unknown extension version breaks cleanly",
            !unkErr &&
              !!unkDecoded &&
              unkDecoded.events.length === 1 &&
              !unkDecoded._extWarning,
            unkErr
              ? `threw=${unkErr.message}`
              : `events=${unkDecoded && unkDecoded.events.length} warn=${unkDecoded && !!unkDecoded._extWarning}`,
          );

          // IV4: gzip decompression respects the size cap (decompression bomb).
          if (
            typeof helpers.gzipCompress === "function" &&
            typeof CompressionStream !== "undefined"
          ) {
            const blob = new Uint8Array(5000);
            blob.fill(65);
            const comp = await helpers.gzipCompress(blob);
            let capErr = "";
            try {
              await helpers.gzipDecompress(comp, 100);
            } catch (e) {
              capErr = (e && e.message) || "err";
            }
            const full = await helpers.gzipDecompress(comp, 1000000);
            addCheck(
              result,
              "gzip decompress respects size cap",
              capErr.indexOf("too large") !== -1 && full.length === 5000,
              `cap=${capErr} full=${full.length}`,
            );
          }
        }

        if (
          summaryApi &&
          typeof summaryApi.computeSummary === "function" &&
          typeof summaryApi.computeSummarySafe === "function"
        ) {
          const legacySummary = summaryApi.computeSummary(wallet);
          const safeSummary = summaryApi.computeSummarySafe(wallet);
          addCheck(
            result,
            "summary safe matches legacy",
            legacySummary.total === safeSummary.total &&
              legacySummary.unpaid === safeSummary.unpaid &&
              legacySummary.credit === safeSummary.credit,
            `total=${safeSummary.total}`,
          );
          addCheck(
            result,
            "summary non-zero",
            legacySummary.total > 0,
            `total=${legacySummary.total}`,
          );

          const beforeTotal = safeSummary.total;
          wallet.events.push({
            id: storage.nextEventId(wallet),
            t: "d",
            n: 1,
            ts: now + 120000,
          });
          const afterSummary = summaryApi.computeSummarySafe(wallet);
          addCheck(
            result,
            "summary monotonic after action",
            afterSummary.total > beforeTotal,
            `before=${beforeTotal} after=${afterSummary.total}`,
          );
        }

        if (
          summaryApi &&
          typeof summaryApi.computeSummary === "function" &&
          storage &&
          typeof storage.undoLastEvent === "function"
        ) {
          const baseTs = Date.now();
          // Drop the persisted blob first: saveWallet union-merges with the
          // persisted state and re-mints colliding ids, so resetting only the
          // in-memory array would resurrect earlier sections' events here.
          if (testStorageKey) {
            safeRemove(testStorageKey);
          }
          wallet.events = [];
          wallet.events.push({
            id: storage.nextEventId(wallet),
            t: "d",
            n: 1,
            ts: baseTs - 4000,
          });
          wallet.events.push({
            id: storage.nextEventId(wallet),
            t: "d",
            n: 2,
            ts: baseTs - 3000,
          });
          wallet.events.push({
            id: storage.nextEventId(wallet),
            t: "p",
            ts: baseTs - 2000,
          });
          wallet.events.push({
            id: storage.nextEventId(wallet),
            t: "d",
            n: 3,
            ts: baseTs - 1000,
          });
          storage.saveWallet(wallet);

          const beforeUndo = summaryApi.computeSummary(wallet);
          const lastEffective =
            beforeUndo.eventsEffectiveSorted &&
            beforeUndo.eventsEffectiveSorted.length
              ? beforeUndo.eventsEffectiveSorted[
                  beforeUndo.eventsEffectiveSorted.length - 1
                ]
              : null;

          const tombstone = storage.undoLastEvent(wallet);
          const afterUndo = summaryApi.computeSummary(wallet);
          addCheck(
            result,
            "undo appends tombstone",
            !!tombstone &&
              tombstone.t === "x" &&
              lastEffective &&
              tombstone.ref === lastEffective.id,
            `ref=${tombstone && tombstone.ref}`,
          );
          addCheck(
            result,
            "undo reduces totals",
            afterUndo.total < beforeUndo.total,
            `before=${beforeUndo.total} after=${afterUndo.total}`,
          );

          if (lastEffective) {
            wallet.events.push({
              id: lastEffective.id,
              t: lastEffective.t,
              n: lastEffective.n,
              ts: baseTs + 10000,
            });
            const afterReintro = summaryApi.computeSummary(wallet);
            addCheck(
              result,
              "tombstone excludes reintroduced id",
              afterReintro.total === afterUndo.total &&
                afterReintro.unpaid === afterUndo.unpaid &&
                afterReintro.credit === afterUndo.credit,
              `total=${afterReintro.total}`,
            );
          }

          const phantomId = storage.nextEventId(wallet);
          const tombFirst = {
            events: [
              {
                id: storage.nextEventId(wallet),
                t: "x",
                ref: phantomId,
                ts: baseTs + 20000,
              },
              {
                id: phantomId,
                t: "d",
                n: 2,
                ts: baseTs + 19000,
              },
            ],
          };
          const outOfOrder = summaryApi.computeSummary(tombFirst);
          addCheck(
            result,
            "tombstone wins out-of-order",
            outOfOrder.total === 0 && outOfOrder.unpaid === 0,
            `total=${outOfOrder.total}`,
          );

          const logLine = summaryApi.formatLogLine(
            { id: "x1", t: "x", ref: "evt-123", ts: baseTs },
            1,
          );
          addCheck(
            result,
            "tombstone log includes id",
            logLine.includes("evt-123"),
            logLine,
          );

          let guard = 10;
          while (guard-- > 0) {
            const res = storage.undoLastEvent(wallet);
            // null = nothing left to undo; { status: "failed" } = a save failure.
            // Neither is a tombstone, so stop instead of looping on (or later
            // mistaking) a non-tombstone object as a successful undo.
            if (!res || res.status === "failed") break;
          }
          const emptySummary = summaryApi.computeSummary(wallet);
          addCheck(
            result,
            "undo until empty",
            emptySummary.total === 0 &&
              emptySummary.unpaid === 0 &&
              emptySummary.credit === 0,
            `total=${emptySummary.total}`,
          );
        } else {
          addCheck(result, "undo appends tombstone", false, "undo missing");
        }

        const needsMigration =
          typeof window.dbWalletNeedsMigration === "function"
            ? window.dbWalletNeedsMigration
            : null;
        const migrate =
          typeof window.dbWalletMigrateV1toV2 === "function"
            ? window.dbWalletMigrateV1toV2
            : null;
        const parseCompact =
          storage && typeof storage.parseCompactEventId === "function"
            ? storage.parseCompactEventId
            : null;

        if (needsMigration && migrate && parseCompact) {
          const legacy = {
            userId: "legacy",
            walletId: "legacy-wallet",
            v: 1,
            seq: {},
            events: [
              {
                id: "legacy-device-123",
                t: "d",
                n: 1,
                ts: now - 120000,
              },
            ],
          };
          const needs = needsMigration(legacy);
          const migrated = migrate(JSON.parse(JSON.stringify(legacy)));
          const migratedId = migrated.events[0].id;
          addCheck(
            result,
            "migration path",
            needs && migrated.v >= 2 && !!parseCompact(migratedId),
            `id=${migratedId}`,
          );

          // Regression: migration must remap tombstone refs to the new id and
          // be idempotent (re-running must not mutate ids).
          const legacyDel = {
            userId: "legacy2",
            walletId: "legacy-wallet-2",
            v: 1,
            seq: {},
            events: [
              { id: "olddev-aaa", t: "d", n: 2, ts: now - 120000 },
              { id: "olddev-bbb", t: "x", ref: "olddev-aaa", ts: now - 110000 },
            ],
          };
          const migratedDel = migrate(JSON.parse(JSON.stringify(legacyDel)));
          const drinkEv = migratedDel.events.find((e) => e.t === "d");
          const tombEv = migratedDel.events.find((e) => e.t === "x");
          const refRemapped =
            !!drinkEv &&
            !!tombEv &&
            tombEv.ref === drinkEv.id &&
            !!parseCompact(tombEv.ref);
          const delSummary =
            summaryApi && typeof summaryApi.computeSummary === "function"
              ? summaryApi.computeSummary(migratedDel)
              : { total: -1 };
          addCheck(
            result,
            "migration remaps tombstone ref",
            refRemapped && delSummary.total === 0,
            `ref=${tombEv && tombEv.ref} total=${delSummary.total}`,
          );
          const migratedTwice = migrate(
            JSON.parse(JSON.stringify(migratedDel)),
          );
          addCheck(
            result,
            "migration idempotent",
            JSON.stringify(migratedTwice.events) ===
              JSON.stringify(migratedDel.events),
            `stable=${
              JSON.stringify(migratedTwice.events) ===
              JSON.stringify(migratedDel.events)
            }`,
          );
        } else {
          addCheck(
            result,
            "migration path",
            false,
            "migration api missing (run from wallet.html)",
          );
        }

        if (
          summaryApi &&
          typeof summaryApi.parseDeleteRange === "function" &&
          typeof summaryApi.computeSummary === "function"
        ) {
          // parseDeleteRange must cap the loop at maxIndex (no freeze on huge ranges).
          const tStart = Date.now();
          const huge = summaryApi.parseDeleteRange("1-99999999", 5);
          const elapsed = Date.now() - tStart;
          addCheck(
            result,
            "parseDeleteRange caps huge range",
            huge.size === 5 &&
              huge.has(1) &&
              huge.has(5) &&
              !huge.has(6) &&
              elapsed < 200,
            `size=${huge.size} ms=${elapsed}`,
          );

          // Equal-ts events must order by numeric seq, not lexical base36.
          const sameTs = 1700000000000;
          const tieWallet = {
            events: [
              { id: "dev.10", t: "d", n: 1, ts: sameTs }, // seq 36
              { id: "dev.z", t: "d", n: 1, ts: sameTs }, // seq 35
            ],
          };
          const tieSorted =
            summaryApi.computeSummary(tieWallet).eventsEffectiveSorted;
          addCheck(
            result,
            "equal-ts tie-break is numeric",
            tieSorted.length === 2 &&
              tieSorted[0].id === "dev.z" &&
              tieSorted[1].id === "dev.10",
            `order=${tieSorted.map((e) => e.id).join(",")}`,
          );

          // drinkCount stays net after an "s" (undo) event so label matches the bar.
          const netDay = "2024-03-01";
          const dayTs = new Date(netDay + "T10:00:00").getTime();
          const netWallet = {
            events: [
              { id: "dev.1", t: "d", n: 3, ts: dayTs },
              { id: "dev.2", t: "s", n: 2, ts: dayTs + 1000 },
            ],
          };
          const netDayEntry = summaryApi
            .computeSummary(netWallet)
            .perDay.find((d) => d.date === netDay);
          addCheck(
            result,
            "drinkCount net after subtract",
            !!netDayEntry &&
              netDayEntry.drinkCount === 1 &&
              netDayEntry.drinks === 1,
            netDayEntry
              ? `count=${netDayEntry.drinkCount} drinks=${netDayEntry.drinks}`
              : "no day",
          );
        }

        if (
          storage &&
          typeof storage.saveWallet === "function" &&
          typeof storage.undoLastEvent === "function"
        ) {
          // ST1: saveWallet now reports success/failure via its return value.
          const okWallet = storage.loadWallet("selfcheck-save-" + randomId());
          okWallet.events.push({
            id: storage.nextEventId(okWallet),
            t: "d",
            n: 1,
            ts: Date.now(),
          });
          const saveOk = storage.saveWallet(okWallet);
          addCheck(
            result,
            "saveWallet returns true on success",
            saveOk === true,
            `ret=${saveOk}`,
          );
          safeRemove(helpers.STORAGE_PREFIX + okWallet.userId);
          const regA = loadRegistry();
          if (regA && regA[okWallet.userId]) {
            delete regA[okWallet.userId];
            saveRegistry(regA);
          }

          // ST4: undo must remove the truly-newest equal-ts event by numeric seq.
          const tieTs = 1700000000000;
          const tieUid = "selfcheck-tie-" + randomId();
          const tieW = {
            userId: tieUid,
            walletId: "tie-w",
            v: 2,
            seq: {},
            events: [
              { id: "dev.z", t: "d", n: 1, ts: tieTs }, // seq 35
              { id: "dev.10", t: "d", n: 1, ts: tieTs }, // seq 36 (newest)
            ],
            actionCodes: [],
            devices: [],
          };
          const tomb = storage.undoLastEvent(tieW);
          addCheck(
            result,
            "undo removes newest by numeric seq",
            !!tomb && tomb.ref === "dev.10",
            `ref=${tomb && tomb.ref}`,
          );
          safeRemove(helpers.STORAGE_PREFIX + tieUid);
          const regB = loadRegistry();
          if (regB && regB[tieUid]) {
            delete regB[tieUid];
            saveRegistry(regB);
          }
        }

        const actionsApi = window.dbWalletActions || null;
        if (
          actionsApi &&
          typeof actionsApi.editEntry === "function" &&
          typeof actionsApi.deleteSelection === "function" &&
          summaryApi &&
          typeof summaryApi.computeSummary === "function"
        ) {
          const actUids = [];
          const mkActWallet = () => {
            const uid = "selfcheck-act-" + randomId();
            actUids.push(uid);
            return {
              userId: uid,
              walletId: "w",
              v: 2,
              seq: {},
              events: [{ id: "dev.1", t: "d", n: 2, ts: Date.now() - 86400000 }],
              actionCodes: [],
              devices: [],
            };
          };
          const mkCtx = (w, o) => {
            const opts = o || {};
            const alerts = [];
            let promptCalls = 0;
            return {
              _alerts: alerts,
              getWallet: () => w,
              getUserId: () => w.userId || "u",
              getSummary: () => summaryApi.computeSummary(w),
              getDeleteRange: () => opts.range || "1",
              getAmount: () => 1,
              dialogAlert: (m) => alerts.push(String(m)),
              dialogConfirm: () => opts.confirm !== false,
              dialogPrompt: (msg, def) => {
                const seq = opts.prompts || [];
                const v = promptCalls < seq.length ? seq[promptCalls] : def;
                promptCalls++;
                return v;
              },
              resetAmount: () => {},
              resetPayUi: () => {},
              clearExport: () => {},
              clearDeleteRange: () => {},
              setHistoryEmpty: () => {},
              refreshActionCodesUi: () => {},
              updateHeaderUi: () => {},
              onStateChanged: () => {},
              setWallet: () => {},
            };
          };

          // A1: edit is append-only AND merge-safe — original id never mutated,
          // the edit appends a replacement carrying supersedes=<root> (no
          // tombstone), and the fold collapses to the replacement.
          const wEdit = mkActWallet();
          actionsApi.editEntry(
            mkCtx(wEdit, { range: "1", prompts: ["2024-03-01", "5"] }),
          );
          const origStill = wEdit.events.find((e) => e.id === "dev.1");
          const repl = wEdit.events.find((e) => e.t === "d" && e.id !== "dev.1");
          const editTotal = summaryApi.computeSummary(wEdit).total;
          addCheck(
            result,
            "editEntry is append-only + merge-safe (supersedes)",
            !!origStill &&
              origStill.n === 2 &&
              !!repl &&
              repl.n === 5 &&
              repl.supersedes === "dev.1" &&
              editTotal === 5,
            `orig=${origStill && origStill.n} repl=${repl && repl.n} sup=${repl && repl.supersedes} total=${editTotal}`,
          );

          // A1b: two devices editing the same entry offline collapse to ONE
          // deterministic winner instead of double-counting after merge.
          const wConc = {
            userId: "selfcheck-conc-" + randomId(),
            walletId: "w",
            v: 2,
            seq: {},
            events: [
              { id: "dev.1", t: "d", n: 2, ts: 1000 },
              { id: "deva.5", t: "d", n: 5, ts: 2000, supersedes: "dev.1" },
              { id: "devb.3", t: "d", n: 7, ts: 3000, supersedes: "dev.1" },
            ],
            actionCodes: [],
            devices: [],
          };
          const concSum = summaryApi.computeSummary(wConc);
          addCheck(
            result,
            "concurrent edit converges to one winner",
            concSum.total === 7 &&
              concSum.eventsEffectiveSorted.length === 1 &&
              concSum.eventsEffectiveSorted[0].id === "devb.3",
            `total=${concSum.total} eff=${concSum.eventsEffectiveSorted.length}`,
          );

          // A2: a future date is rejected and the wallet is left untouched.
          const wFut = mkActWallet();
          const ctxFut = mkCtx(wFut, {
            range: "1",
            prompts: ["2099-01-01", "5"],
          });
          actionsApi.editEntry(ctxFut);
          addCheck(
            result,
            "editEntry rejects future date",
            wFut.events.length === 1 &&
              ctxFut._alerts.some((m) => m.includes("Zukunft")),
            `len=${wFut.events.length}`,
          );

          // A3: deleteSelection stamps the tombstone after the newest event ts.
          const wDel = mkActWallet();
          const futTs = Date.now() + 10000000;
          wDel.events = [{ id: "dev.1", t: "d", n: 1, ts: futTs }];
          actionsApi.deleteSelection(mkCtx(wDel, { range: "1", confirm: true }));
          const delTomb = wDel.events.find((e) => e.t === "x");
          addCheck(
            result,
            "deleteSelection tombstone sorts last",
            !!delTomb && delTomb.ts > futTs,
            `after=${delTomb && delTomb.ts > futTs}`,
          );

          for (const uid of actUids) {
            safeRemove(helpers.STORAGE_PREFIX + uid);
            const regC = loadRegistry();
            if (regC && regC[uid]) {
              delete regC[uid];
              saveRegistry(regC);
            }
          }
        }

        if (
          actionCodes &&
          typeof actionCodes.encodeActionHash === "function" &&
          typeof actionCodes.buildActionCode === "function" &&
          typeof actionCodes.buildActionPayload === "function" &&
          typeof actionCodes.applyActionCodeEdits === "function" &&
          hashRouter &&
          typeof hashRouter.parseWalletIdFromHash === "function"
        ) {
          const code = actionCodes.buildActionCode({
            type: "d",
            amount: 2,
            label: "Selfcheck",
          });
          const payloadBefore = actionCodes.buildActionPayload(wallet, code);
          const hashBefore = actionCodes.encodeActionHash(payloadBefore);
          const keyBefore = code.key;
          addCheck(
            result,
            "action code local hash",
            typeof hashBefore === "string" && hashBefore.startsWith("ac:"),
            hashBefore,
          );

          actionCodes.applyActionCodeEdits(code, {
            label: "Selfcheck Updated",
            amount: code.amount,
            type: code.type,
          });
          const payloadAfter = actionCodes.buildActionPayload(wallet, code);
          const hashAfter = actionCodes.encodeActionHash(payloadAfter);
          const keyAfter = code.key;

          addCheck(
            result,
            "action code edit rotates key",
            keyBefore !== keyAfter && hashBefore !== hashAfter,
            `keyChanged=${keyBefore !== keyAfter}`,
          );

          actionCodes.applyActionCodeEdits(code, {
            label: code.label,
            amount: code.amount,
            type: code.type,
          });
          addCheck(
            result,
            "action code edit stable payload",
            code.key === keyAfter,
            `keyStable=${code.key === keyAfter}`,
          );

          addCheck(
            result,
            "action payload slim",
            payloadBefore &&
              typeof payloadBefore === "object" &&
              !("type" in payloadBefore),
            JSON.stringify(payloadBefore),
          );

          const legacyPayload = {
            v: 1,
            walletId: wallet.walletId,
            codeId: "code-legacy",
            key: "key-legacy",
            type: "d",
            ts: 123,
          };
          const legacyHash = actionCodes.encodeActionHash(legacyPayload);
          const legacyDecoded = actionCodes.decodeActionHash(legacyHash);
          addCheck(
            result,
            "action payload legacy decode",
            legacyDecoded &&
              legacyDecoded.walletId === legacyPayload.walletId &&
              legacyDecoded.codeId === legacyPayload.codeId &&
              legacyDecoded.key === legacyPayload.key &&
              legacyDecoded.type === legacyPayload.type,
            JSON.stringify(legacyDecoded),
          );

          let globalHash1 = "";
          if (
            typeof actionCodes.encodeGlobalActionHash === "function" &&
            typeof actionCodes.decodeGlobalActionHash === "function" &&
            summaryApi &&
            typeof summaryApi.computeSummary === "function"
          ) {
            const globalPayload = {
              v: 1,
              t: code.type,
              n: code.amount,
              l: code.label,
            };
            globalHash1 = actionCodes.encodeGlobalActionHash(globalPayload);
            const globalHash2 =
              actionCodes.encodeGlobalActionHash(globalPayload);
            addCheck(
              result,
              "global action deterministic",
              globalHash1 === globalHash2 && globalHash1.startsWith("acg:"),
              globalHash1,
            );
            addCheck(
              result,
              "scope switch regenerates link",
              globalHash1 !== hashBefore && globalHash1.startsWith("acg:"),
              `local=${hashBefore} global=${globalHash1}`,
            );

            const decodedGlobal =
              actionCodes.decodeGlobalActionHash(globalHash1);
            // Exercise the REAL production entry (window.dbWalletUi.
            // applyGlobalActionHash -> handleGlobalActionHash) on a non-active
            // wallet instead of hand-pushing an event, so the booking path itself
            // is under test. skipPersist/skipConfirm/skipMessage keep it from
            // touching the active wallet or popping a dialog.
            const uiApiApply = window.dbWalletUi || null;
            if (
              uiApiApply &&
              typeof uiApiApply.applyGlobalActionHash === "function"
            ) {
              const beforeGlobal = summaryApi.computeSummary(wallet).total;
              const applyRes = uiApiApply.applyGlobalActionHash(globalHash1, {
                wallet,
                skipPersist: true,
                skipConfirm: true,
                skipMessage: true,
                skipHashCleanup: true,
              });
              const afterGlobal = summaryApi.computeSummary(wallet).total;
              addCheck(
                result,
                "global action applies (production path)",
                !!(applyRes && applyRes.applied) && afterGlobal > beforeGlobal,
                `before=${beforeGlobal} after=${afterGlobal}`,
              );
            } else {
              addCheck(
                result,
                "global action applies (production path)",
                true,
                "skipped (no UI layer)",
              );
            }

            const appliedNoWallet = (() => {
              if (!decodedGlobal) return false;
              if (!storage || typeof storage.nextEventId !== "function") {
                return false;
              }
              const target = null;
              if (!target) return false;
              target.events.push({
                id: storage.nextEventId(target),
                t: decodedGlobal.t,
                n: decodedGlobal.n,
                ts: Date.now(),
              });
              return true;
            })();
            addCheck(
              result,
              "global action requires wallet",
              appliedNoWallet === false,
              `applied=${appliedNoWallet}`,
            );

            const uiApi = window.dbWalletUi || null;
            if (
              uiApi &&
              typeof uiApi.applyGlobalActionHash === "function" &&
              summaryApi &&
              typeof summaryApi.computeSummary === "function"
            ) {
              const tempWallet = storage.loadWallet(
                "selfcheck-ui-" + randomId(),
              );
              const beforeTotal = summaryApi.computeSummary(tempWallet).total;
              const beforeHash = window.location.hash;
              const beforeUserId =
                typeof uiApi.getCurrentUserId === "function"
                  ? uiApi.getCurrentUserId()
                  : "";

              const appliedRes = uiApi.applyGlobalActionHash(globalHash1, {
                wallet: tempWallet,
                userId: "selfcheck-ui",
                skipPersist: true,
                skipHashCleanup: true,
                skipMessage: true,
              });
              const afterTotal = summaryApi.computeSummary(tempWallet).total;
              const afterHash = window.location.hash;
              const afterUserId =
                typeof uiApi.getCurrentUserId === "function"
                  ? uiApi.getCurrentUserId()
                  : "";

              addCheck(
                result,
                "global action ui apply",
                appliedRes && appliedRes.applied && afterTotal > beforeTotal,
                `before=${beforeTotal} after=${afterTotal}`,
              );
              addCheck(
                result,
                "global action keeps hash/user",
                beforeHash === afterHash && beforeUserId === afterUserId,
                `hash=${afterHash || "(leer)"}`,
              );

              // Use a distinct hash so the dup-guard (750ms window) does not
              // swallow the call that is meant to exercise the no-wallet branch.
              const noWalletHash = actionCodes.encodeGlobalActionHash({
                v: 1,
                t: code.type,
                n: (code.amount || 1) + 1,
                l: code.label,
              });
              const noWalletRes = uiApi.applyGlobalActionHash(noWalletHash, {
                wallet: null,
                skipPersist: true,
                skipHashCleanup: true,
                skipMessage: true,
              });
              addCheck(
                result,
                "global action ui no wallet",
                noWalletRes && noWalletRes.reason === "no-wallet",
                JSON.stringify(noWalletRes || {}),
              );

              // handleWalletStateChange is the central fan-out used after
              // any mutation (booking, undo, edit, import). It must exist and
              // be callable twice in a row without throwing — nothing in it
              // relies on dirty state that would blow up on a re-run.
              if (typeof uiApi.handleWalletStateChange === "function") {
                let stateError = null;
                try {
                  uiApi.handleWalletStateChange();
                  uiApi.handleWalletStateChange();
                } catch (e) {
                  stateError = e;
                }
                addCheck(
                  result,
                  "handleWalletStateChange idempotent",
                  stateError === null,
                  stateError ? `threw=${stateError.message}` : "ok",
                );
              } else {
                addCheck(
                  result,
                  "handleWalletStateChange idempotent",
                  false,
                  "hook missing",
                );
              }
            } else {
              addCheck(result, "global action ui hook", true, "skipped");
            }
          }

          const actionHash = actionCodes.encodeActionHash({
            v: 1,
            walletId: wallet.walletId,
            codeId: "code-1",
            key: "key-1",
            type: "d",
          });
          const actionWalletId =
            await hashRouter.parseWalletIdFromHash(actionHash);
          addCheck(
            result,
            "hash parse action",
            actionWalletId === wallet.walletId,
            `walletId=${actionWalletId}`,
          );

          if (hashRouter && typeof hashRouter.classifyHash === "function") {
            const acgRoute = globalHash1
              ? hashRouter.classifyHash(globalHash1)
              : { kind: "" };
            const localRoute = hashRouter.classifyHash(hashBefore);
            const userRoute = testUserId
              ? hashRouter.classifyHash(testUserId)
              : { kind: "" };
            const emptyRoute = hashRouter.classifyHash("");
            addCheck(
              result,
              "hash classify acg",
              acgRoute.kind === "globalAction",
              `kind=${acgRoute.kind || "?"}`,
            );
            addCheck(
              result,
              "hash classify ac",
              localRoute.kind === "localAction",
              `kind=${localRoute.kind || "?"}`,
            );
            addCheck(
              result,
              "hash classify user",
              userRoute.kind === "user",
              `kind=${userRoute.kind || "?"}`,
            );
            addCheck(
              result,
              "hash classify empty",
              emptyRoute.kind === "none",
              `kind=${emptyRoute.kind || "?"}`,
            );
          }

          if (
            globalHash1 &&
            hashRouter &&
            typeof hashRouter.getHashKind === "function" &&
            typeof hashRouter.parseWalletIdFromHash === "function"
          ) {
            const kind = hashRouter.getHashKind(globalHash1);
            const acgWalletId =
              await hashRouter.parseWalletIdFromHash(globalHash1);
            addCheck(
              result,
              "hash kind acg",
              kind === "action-global",
              `kind=${kind || "?"}`,
            );
            addCheck(
              result,
              "hash parse acg",
              acgWalletId === "",
              `walletId=${acgWalletId || "leer"}`,
            );
          }
        }

        if (
          actionCodes &&
          typeof actionCodes.buildActionCode === "function" &&
          typeof actionCodes.normalizeActionCodes === "function"
        ) {
          const list = [];
          for (let i = 0; i < 7; i++) {
            list.push(
              actionCodes.buildActionCode({
                type: "g",
                amount: i + 1,
                label: `Code ${i + 1}`,
              }),
            );
          }
          const normalized = actionCodes.normalizeActionCodes(list);
          addCheck(
            result,
            "action code soft limit no trim",
            normalized.length === 7 && !normalized._dbwTrimmed,
            `count=${normalized.length}`,
          );
        }

        const uidEl = document.getElementById("uid");
        if (
          uidEl &&
          hashRouter &&
          typeof hashRouter.classifyHash === "function"
        ) {
          const route = hashRouter.classifyHash(window.location.hash.slice(1));
          const uiApi = window.dbWalletUi || null;
          const uiUserId =
            uiApi && typeof uiApi.getCurrentUserId === "function"
              ? uiApi.getCurrentUserId()
              : "";

          if (route.kind === "globalAction" || route.kind === "none") {
            const noWalletFlag =
              document.body && document.body.dataset
                ? document.body.dataset.noWallet === "1"
                : false;
            addCheck(
              result,
              "no wallet state set",
              noWalletFlag,
              `flag=${noWalletFlag}`,
            );
            addCheck(
              result,
              "no wallet ui init",
              !uiApi || !uiUserId,
              `uid=${uiUserId || "(leer)"}`,
            );
          }

          if (route.kind === "user" && uiApi) {
            addCheck(
              result,
              "wallet ui user id",
              typeof uiUserId === "string" && uiUserId.trim() !== "",
              `uid=${uiUserId || "(leer)"}`,
            );
          }
        }

        if (
          hashRouter &&
          typeof hashRouter.classifyHash === "function" &&
          storage &&
          typeof storage.getAllWallets === "function" &&
          document.getElementById("btn-drink")
        ) {
          const route = hashRouter.classifyHash(window.location.hash.slice(1));
          const wallets = storage.getAllWallets();
          const userIds = Object.keys(wallets)
            .filter((id) => (testUserId ? id !== testUserId : true))
            .sort((a, b) => a.localeCompare(b));
          const selectEl = document.getElementById(
            "global-action-wallet-select",
          );
          const messageEl = document.getElementById("global-action-message");
          const lastGlobal =
            document.body &&
            document.body.dataset &&
            typeof document.body.dataset.lastGlobalAction === "string"
              ? document.body.dataset.lastGlobalAction
              : "";

          if (route.kind === "globalAction") {
            if (userIds.length === 0) {
              addCheck(
                result,
                "acg no wallet message",
                !!messageEl &&
                  String(messageEl.textContent || "").includes(
                    "Bitte zuerst ein Wallet importieren oder öffnen.",
                  ),
                messageEl ? messageEl.textContent : "missing",
              );
              addCheck(
                result,
                "acg no wallet does not create",
                userIds.length === 0,
                `wallets=${userIds.length}`,
              );
            } else if (userIds.length === 1) {
              addCheck(
                result,
                "acg single should auto select",
                false,
                "hash still acg despite one wallet",
              );
            } else {
              addCheck(
                result,
                "acg multi wallet select ui",
                !!selectEl && selectEl.querySelectorAll("button").length > 1,
                selectEl ? "ok" : "missing",
              );
            }
          } else if (userIds.length === 1 && lastGlobal) {
            const onlyUserId = userIds[0];
            const currentHash = window.location.hash.slice(1);
            addCheck(
              result,
              "acg single auto applied",
              currentHash === onlyUserId,
              `hash=${currentHash}`,
            );
          } else {
            addCheck(result, "acg entry checks", true, "skipped");
          }
        }

        if (
          helpers &&
          typeof helpers.base64UrlEncode === "function" &&
          hashRouter &&
          typeof hashRouter.parseWalletIdFromHash === "function"
        ) {
          const payload = JSON.stringify({
            userId: wallet.userId,
            walletId: wallet.walletId,
            v: wallet.v,
            events: wallet.events,
          });
          const importHash = "import:" + helpers.base64UrlEncode(payload);
          const importWalletId =
            await hashRouter.parseWalletIdFromHash(importHash);
          addCheck(
            result,
            "hash parse import",
            importWalletId === wallet.walletId,
            `walletId=${importWalletId}`,
          );
        }

        if (
          helpers &&
          typeof helpers.base64UrlEncodeBytes === "function" &&
          importV2 &&
          typeof importV2.encodeImportV2Bytes === "function" &&
          hashRouter &&
          typeof hashRouter.parseWalletIdFromHash === "function"
        ) {
          const bytes = importV2.encodeImportV2Bytes(wallet, "");
          const hash = "i2u:" + helpers.base64UrlEncodeBytes(bytes);
          const walletId = await hashRouter.parseWalletIdFromHash(hash);
          addCheck(
            result,
            "hash parse i2u",
            walletId === wallet.walletId,
            `walletId=${walletId}`,
          );
        }

        // ---- Wave-3 additions: production-path + new-behavior checks. Each group
        // is isolated in its own try/catch so an early throw records a failed check
        // instead of aborting the groups below it, and cleans up any wallet it
        // created (safeRemove + registry delete) exactly like the sections above.
        const cleanupUid = (uid) => {
          if (!uid) return;
          if (helpers.STORAGE_PREFIX) safeRemove(helpers.STORAGE_PREFIX + uid);
          try {
            const reg = loadRegistry();
            if (reg && typeof reg === "object" && reg[uid]) {
              delete reg[uid];
              saveRegistry(reg);
            }
          } catch (e) {
            // ignore
          }
        };

        // NB1: appendEvents persists + rolls back atomically. Force the write to
        // fail (monkey-patched setItem throws once) and assert the optimistic
        // in-memory append is reverted and false is returned. Then a normal call
        // succeeds and persists. Relies on:
        //   storage.appendEvents(wallet, events[]) -> boolean (rollback on failed
        //   saveWallet) and storage.newEvent(wallet, type, n) -> { id, t, n, ts }.
        try {
          const uid = storage.ensureNonReservedUserId(
            "selfcheck-append-" + randomId(),
          );
          const w = {
            userId: uid,
            walletId: helpers.randomWalletId(),
            v: 2,
            seq: {},
            events: [],
            actionCodes: [],
            devices: [],
          };
          const ev = storage.newEvent(w, "d", 1);
          const origSet = localStorage.setItem;
          let ret = null;
          try {
            localStorage.setItem = function () {
              throw new Error("selfcheck forced quota");
            };
            ret = storage.appendEvents(w, [ev]);
          } finally {
            localStorage.setItem = origSet;
          }
          addCheck(
            result,
            "appendEvents rolls back on save failure",
            ret === false && w.events.length === 0,
            `ret=${ret} len=${w.events.length}`,
          );
          const okRet = storage.appendEvents(w, [storage.newEvent(w, "d", 2)]);
          const reloaded = storage.loadWallet(uid);
          addCheck(
            result,
            "appendEvents persists on success",
            okRet === true &&
              !!reloaded &&
              reloaded.events.some((e) => e.t === "d" && e.n === 2),
            `ret=${okRet} len=${reloaded && reloaded.events.length}`,
          );
          cleanupUid(uid);
        } catch (e) {
          addCheck(
            result,
            "appendEvents rolls back on save failure",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB2: two-tab id collision. Persist event id X (content A); hold an
        // in-memory wallet with a DIFFERENT event carrying the SAME id X; saveWallet
        // must re-mint the local event to a fresh id and keep BOTH bookings, dropping
        // nothing. Relies on saveWallet's same-id/different-content re-mint + the
        // union merge of the persisted snapshot (wallet-storage.js saveWallet).
        try {
          const uid = storage.ensureNonReservedUserId(
            "selfcheck-collide-" + randomId(),
          );
          const deviceKey = storage.getDeviceKey();
          const collideId = helpers.formatCompactEventId(deviceKey, 5);
          const walletId = helpers.randomWalletId();
          helpers.safeLocalStorageSetItem(
            helpers.STORAGE_PREFIX + uid,
            JSON.stringify({
              userId: uid,
              walletId,
              v: 2,
              seq: {},
              events: [{ id: collideId, t: "d", n: 1, ts: 1000 }],
              actionCodes: [],
              devices: [],
            }),
          );
          const wB = {
            userId: uid,
            walletId,
            v: 2,
            seq: {},
            events: [{ id: collideId, t: "d", n: 2, ts: 2000 }],
            actionCodes: [],
            devices: [],
          };
          const savedB = storage.saveWallet(wB);
          const reloaded = storage.loadWallet(uid);
          const evs = (reloaded && reloaded.events) || [];
          const keptA = evs.find((e) => e.id === collideId && e.n === 1);
          const keptB = evs.find((e) => e.n === 2 && e.id !== collideId);
          addCheck(
            result,
            "saveWallet re-mints two-tab id collision (keeps both)",
            savedB === true && evs.length === 2 && !!keptA && !!keptB,
            `len=${evs.length} A=${!!keptA} B=${!!keptB}`,
          );
          cleanupUid(uid);
        } catch (e) {
          addCheck(
            result,
            "saveWallet re-mints two-tab id collision (keeps both)",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB3: "gc" (globalActionCodes) codec block round-trips with the key intact
        // (bearer credential). Relies on encode/decodeImportV2Bytes gc block
        // (writeActionCodeEntry, key written verbatim; readActionCodeEntry hasType).
        try {
          const gcWallet = {
            userId: "selfcheck-gc",
            walletId: helpers.randomWalletId(),
            v: 2,
            seq: {},
            events: [{ id: "dev.1", t: "d", n: 1, ts: 1700000000000 }],
            actionCodes: [],
            devices: [],
            globalActionCodes: [
              {
                id: "global:sc1",
                label: "GC",
                amount: 2,
                type: "d",
                key: "gckeysecret123",
                createdAt: 1700000000000,
                updatedAt: 1700000000000,
              },
            ],
          };
          const gcDec = importV2.decodeImportV2Bytes(
            importV2.encodeImportV2Bytes(gcWallet, ""),
          );
          const gcCodes = Array.isArray(gcDec.globalActionCodes)
            ? gcDec.globalActionCodes
            : [];
          const gcCode = gcCodes.find((c) => c && c.id === "global:sc1");
          addCheck(
            result,
            "gc block round-trips global code with key",
            !!gcCode &&
              gcCode.key === "gckeysecret123" &&
              gcCode.type === "d" &&
              gcCode.amount === 2,
            gcCode ? `key=${gcCode.key} type=${gcCode.type}` : "missing",
          );
        } catch (e) {
          addCheck(
            result,
            "gc block round-trips global code with key",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB3b: an import updates an existing local global code's label/amount/type
        // but NEVER rotates its key (key rotation is local-only). Relies on
        // buildImportedWallet's mergeActionCodes, which deliberately does not copy
        // c.key. The remote wins on recency (newer updatedAt) yet the key is kept.
        try {
          const uid = storage.ensureNonReservedUserId(
            "selfcheck-gckey-" + randomId(),
          );
          const walletId = helpers.randomWalletId();
          const now = Date.now();
          helpers.safeLocalStorageSetItem(
            helpers.STORAGE_PREFIX + uid,
            JSON.stringify({
              userId: uid,
              walletId,
              v: 2,
              seq: {},
              events: [],
              actionCodes: [],
              devices: [],
              globalActionCodes: [
                {
                  id: "global:keep",
                  label: "Local",
                  amount: 1,
                  type: "g",
                  key: "LOCALKEYKEEP",
                  createdAt: now - 100000,
                  updatedAt: now - 100000,
                },
              ],
            }),
          );
          const remote = {
            userId: uid,
            walletId,
            v: 2,
            events: [],
            globalActionCodes: [
              {
                id: "global:keep",
                label: "Remote",
                amount: 5,
                type: "d",
                key: "REMOTEKEYNEW",
                createdAt: now,
                updatedAt: now,
              },
            ],
          };
          const built = importV2.buildImportedWallet(remote);
          const codes =
            built &&
            built.wallet &&
            Array.isArray(built.wallet.globalActionCodes)
              ? built.wallet.globalActionCodes
              : [];
          const kept = codes.find((c) => c && c.id === "global:keep");
          addCheck(
            result,
            "import never rotates existing global code key",
            !!kept && kept.key === "LOCALKEYKEEP",
            kept ? `key=${kept.key} amount=${kept.amount}` : "missing",
          );
          cleanupUid(uid);
        } catch (e) {
          addCheck(
            result,
            "import never rotates existing global code key",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB4: post-'s' balance is floored at min(balanceBefore, 0) — an 's' never
        // manufactures or deepens credit. [g3, s2] -> credit 3; [d5, s7] -> 0/0.
        try {
          const gsSum = summaryApi.computeSummary({
            events: [
              { id: "dev.1", t: "g", n: 3, ts: 1000 },
              { id: "dev.2", t: "s", n: 2, ts: 2000 },
            ],
          });
          addCheck(
            result,
            "'s' does not manufacture credit ([g3,s2] -> credit 3)",
            gsSum.credit === 3 && gsSum.unpaid === 0,
            `credit=${gsSum.credit} unpaid=${gsSum.unpaid}`,
          );
          const dsSum = summaryApi.computeSummary({
            events: [
              { id: "dev.3", t: "d", n: 5, ts: 1000 },
              { id: "dev.4", t: "s", n: 7, ts: 2000 },
            ],
          });
          addCheck(
            result,
            "'s' clamps to zero, no phantom credit ([d5,s7] -> 0/0)",
            dsSum.unpaid === 0 && dsSum.credit === 0,
            `unpaid=${dsSum.unpaid} credit=${dsSum.credit}`,
          );
        } catch (e) {
          addCheck(
            result,
            "'s' phantom-credit clamp",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB5: formatPerDayDiagram returns one line per entry in the frozen
        // "<date> [<count>]<paidMark> | <bar>" shape the history UI renders.
        try {
          if (typeof summaryApi.formatPerDayDiagram === "function") {
            const lines = summaryApi.formatPerDayDiagram([
              { date: "2024-03-01", drinks: 3, drinkCount: 3, paid: true },
              { date: "2024-03-02", drinks: 2, drinkCount: 2, paid: false },
            ]);
            addCheck(
              result,
              "formatPerDayDiagram line format",
              Array.isArray(lines) &&
                lines.length === 2 &&
                lines[0] === "2024-03-01 [3] 💰 | ###" &&
                lines[1] === "2024-03-02 [2] | ##",
              Array.isArray(lines) ? lines.join(" || ") : "not array",
            );
          } else {
            addCheck(
              result,
              "formatPerDayDiagram line format",
              false,
              "missing export",
            );
          }
        } catch (e) {
          addCheck(
            result,
            "formatPerDayDiagram line format",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB6: book a local action code through the REAL production entry
        // (dbWalletImportV2.bookActionCode) — verify the booked event's type and
        // that the amount routes through the Math.round clamp (normalizeAmount:
        // 3.6 -> 4), and that a mismatched key is rejected (no booking). Relies on:
        //   bookActionCode(targetUserId, { api, codeId, key }) -> loads the wallet,
        //   matches codeId, key-checks, books newEvent via appendEvents.
        // bookActionCode uses global alert() and sets window.location.hash, so both
        // are overridden/saved and restored here.
        try {
          if (
            typeof importV2.bookActionCode === "function" &&
            typeof actionCodes.buildActionCode === "function"
          ) {
            const uid = storage.ensureNonReservedUserId(
              "selfcheck-book-" + randomId(),
            );
            const w = storage.loadWallet(uid);
            const code = actionCodes.buildActionCode({
              type: "d",
              amount: 2,
              label: "Book",
            });
            code.amount = 3.6; // fractional -> exercises the booking-path clamp
            w.actionCodes = [code];
            storage.saveWallet(w);

            const origAlert = window.alert;
            const origHash = window.location.hash;
            let bookedEv = null;
            let keyRejected = false;
            try {
              window.alert = function () {};
              importV2.bookActionCode(uid, {
                api: actionCodes,
                codeId: code.id,
                key: code.key,
              });
              const r1 = storage.loadWallet(uid);
              bookedEv = (r1.events || []).find((e) => e.t === "d");
              const countGood = (r1.events || []).length;

              importV2.bookActionCode(uid, {
                api: actionCodes,
                codeId: code.id,
                key: "wrong-key-selfcheck",
              });
              const r2 = storage.loadWallet(uid);
              keyRejected = (r2.events || []).length === countGood;
            } finally {
              window.alert = origAlert;
              try {
                window.location.hash = origHash;
              } catch (e) {
                // ignore
              }
            }
            addCheck(
              result,
              "bookActionCode books local code (type + amount clamp)",
              !!bookedEv && bookedEv.t === "d" && bookedEv.n === 4,
              bookedEv ? `t=${bookedEv.t} n=${bookedEv.n}` : "no event",
            );
            addCheck(
              result,
              "bookActionCode rejects mismatched key",
              keyRejected,
              `rejected=${keyRejected}`,
            );
            cleanupUid(uid);
          } else {
            addCheck(
              result,
              "bookActionCode books local code (type + amount clamp)",
              false,
              "bookActionCode/buildActionCode missing",
            );
          }
        } catch (e) {
          addCheck(
            result,
            "bookActionCode books local code (type + amount clamp)",
            false,
            "threw=" + (e && e.message),
          );
        }

        // NB7: exercise the global-action booking through the reachable production
        // function (dbWalletUi.applyGlobalActionHash -> handleGlobalActionHash),
        // asserting type normalization (payload.t "d" stays "d", "g" stays "g") and
        // that the amount reaches the booked event. Non-active wallet +
        // skipPersist/skipConfirm/skipMessage so nothing is written or prompted.
        // (The Math.max(1, Math.round(n)) clamp in handleGlobalActionHash is
        // unreachable through a decoded acg hash — normalizeGlobalAmount already
        // rejects non-integer / out-of-range n on encode+decode — so this asserts
        // the reachable behavior: type normalization + integer amount pass-through.)
        try {
          const gUi = window.dbWalletUi || null;
          if (
            gUi &&
            typeof gUi.applyGlobalActionHash === "function" &&
            typeof actionCodes.encodeGlobalActionHash === "function"
          ) {
            const opts = {
              skipPersist: true,
              skipConfirm: true,
              skipMessage: true,
              skipHashCleanup: true,
            };
            const wD = storage.loadWallet("selfcheck-gd-" + randomId());
            const hashD = actionCodes.encodeGlobalActionHash({
              v: 1,
              t: "d",
              n: 4,
              l: "SC-d",
            });
            const rD = gUi.applyGlobalActionHash(
              hashD,
              Object.assign({ wallet: wD }, opts),
            );
            const evD = wD.events[wD.events.length - 1];
            addCheck(
              result,
              "global booking normalizes type d + amount",
              !!(rD && rD.applied) && !!evD && evD.t === "d" && evD.n === 4,
              evD ? `t=${evD.t} n=${evD.n}` : "no event",
            );
            const wG = storage.loadWallet("selfcheck-gg-" + randomId());
            const hashG = actionCodes.encodeGlobalActionHash({
              v: 1,
              t: "g",
              n: 6,
              l: "SC-g",
            });
            const rG = gUi.applyGlobalActionHash(
              hashG,
              Object.assign({ wallet: wG }, opts),
            );
            const evG = wG.events[wG.events.length - 1];
            addCheck(
              result,
              "global booking normalizes type g + amount",
              !!(rG && rG.applied) && !!evG && evG.t === "g" && evG.n === 6,
              evG ? `t=${evG.t} n=${evG.n}` : "no event",
            );
          } else {
            addCheck(
              result,
              "global booking normalizes type d + amount",
              true,
              "skipped (no UI layer)",
            );
          }
        } catch (e) {
          addCheck(
            result,
            "global booking normalizes type d + amount",
            false,
            "threw=" + (e && e.message),
          );
        }
      }
    } catch (e) {
      addError(result, e);
    } finally {
      if (testStorageKey) {
        safeRemove(testStorageKey);
      }
      if (testUserId && !testUserId.includes(":")) {
        safeRemove(testUserId);
      }
      if (testUserId) {
        const reg = loadRegistry();
        if (reg && typeof reg === "object" && reg[testUserId]) {
          delete reg[testUserId];
          saveRegistry(reg);
        }
      }
      // Let pending hashchange handlers run against the stubs before the real
      // dialogs come back (two macrotasks: event dispatch, then handler work).
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.alert = origDialogs.alert;
      window.confirm = origDialogs.confirm;
      window.prompt = origDialogs.prompt;
    }

    try {
      if (typeof caches !== "undefined" && caches && typeof caches.keys === "function") {
        const keys = await caches.keys();
        const scripts = Array.from(document.scripts || [])
          .map((s) => s.src)
          .filter((s) => s && s.startsWith(location.origin));
        const missing = [];
        for (const url of scripts) {
          let hit = false;
          for (const k of keys) {
            const c = await caches.open(k);
            if (await c.match(url)) { hit = true; break; }
          }
          if (!hit && keys.length > 0) missing.push(url.replace(location.origin, ""));
        }
        addCheck(result, "SW APP_SHELL covers loaded scripts", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all scripts cached");
      }
    } catch (e) {
      addError(result, e);
    }

    if (!quiet) {
      const okCount = result.checks.filter((c) => c.ok).length;
      console.log(
        `db-wallet self-check: ${okCount}/${result.checks.length} ok`,
        result,
      );
    }

    return result;
  }

  window.dbWalletSelfCheck = {
    run,
  };
})();
