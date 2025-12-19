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
          hashRouter &&
          typeof hashRouter.parseWalletIdFromHash === "function"
        ) {
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
