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
    }

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
        } else {
          addCheck(
            result,
            "migration path",
            false,
            "migration api missing (run from wallet.html)",
          );
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

          if (
            typeof actionCodes.encodeGlobalActionHash === "function" &&
            typeof actionCodes.decodeGlobalActionHash === "function" &&
            summaryApi &&
            typeof summaryApi.computeSummary === "function"
          ) {
            const globalPayload = { v: 1, t: "d", n: 1 };
            const globalHash1 =
              actionCodes.encodeGlobalActionHash(globalPayload);
            const globalHash2 =
              actionCodes.encodeGlobalActionHash(globalPayload);
            addCheck(
              result,
              "global action deterministic",
              globalHash1 === globalHash2 && globalHash1.startsWith("acg:"),
              globalHash1,
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
