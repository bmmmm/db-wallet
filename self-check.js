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
            if (!res) break;
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

          // A1: edit must be append-only (tombstone old + new event), original
          // id never mutated, so cross-device merge can converge.
          const wEdit = mkActWallet();
          actionsApi.editEntry(
            mkCtx(wEdit, { range: "1", prompts: ["2024-03-01", "5"] }),
          );
          const origStill = wEdit.events.find((e) => e.id === "dev.1");
          const tombFor = wEdit.events.find(
            (e) => e.t === "x" && e.ref === "dev.1",
          );
          const repl = wEdit.events.find((e) => e.t === "d" && e.id !== "dev.1");
          const editTotal = summaryApi.computeSummary(wEdit).total;
          addCheck(
            result,
            "editEntry is append-only",
            !!origStill &&
              origStill.n === 2 &&
              !!tombFor &&
              !!repl &&
              repl.n === 5 &&
              editTotal === 5,
            `orig=${origStill && origStill.n} tomb=${!!tombFor} repl=${repl && repl.n} total=${editTotal}`,
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
            const beforeGlobal = summaryApi.computeSummary(wallet).total;
            const appliedWithWallet =
              !!decodedGlobal && !!wallet && !!storage
                ? (() => {
                    wallet.events.push({
                      id: storage.nextEventId(wallet),
                      t: decodedGlobal.t,
                      n: decodedGlobal.n,
                      ts: Date.now() + 5000,
                    });
                    return true;
                  })()
                : false;
            const afterGlobal = summaryApi.computeSummary(wallet).total;
            addCheck(
              result,
              "global action applies",
              appliedWithWallet && afterGlobal > beforeGlobal,
              `before=${beforeGlobal} after=${afterGlobal}`,
            );

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
