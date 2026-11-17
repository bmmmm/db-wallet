// O3.1: an import that meets the P1.9 save lock (wallet reset in another tab)
// must not report "storage full". The JSON import on index.html built the
// wallet before awaiting the mode dialog, so a reset during the dialog made
// the save fail with the generic storage message.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeEnv, makeStorage, REPO } = require("./harness");
const { makePageDocument } = require("./fake-dom");
const { makeActionsCtx } = require("./actions-ctx");

const INDEX_HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const INDEX_SKIP = new Set(["theme.js", "import-preview.js", "sw-register.js"]);
const INDEX_FILES = Array.from(INDEX_HTML.matchAll(/<script src="(?:\.\/)?([^"]+)"/g))
  .map((m) => m[1])
  .filter((f) => !INDEX_SKIP.has(f));

class FakeFileReader {
  readAsText(file) {
    Promise.resolve().then(() => this.onload({ target: { result: file._text } }));
  }
}

function persisted(storage, userId) {
  const raw = storage.getItem("db-wallet:" + userId);
  return raw ? JSON.parse(raw) : null;
}

test("index.html JSON import: a reset during the mode dialog does not fail the import", async () => {
  const storage = makeStorage();
  storage.setItem("db-wallet:device", "devA");
  // Wallet "anna" exists; its export is the JSON we import.
  const tab2 = makeEnv({ storage, files: [...INDEX_FILES.filter((f) => f !== "index-ui.js"), "wallet-actions.js"] });
  const S2 = tab2.dbWalletStorage;
  const anna = S2.loadWallet("anna");
  S2.appendEvents(anna, [S2.newEvent(anna, "d", 1)]);
  const exported = JSON.parse(JSON.stringify(S2.loadWallet("anna")));
  exported.events.push({ id: "devB.1", t: "d", n: 2, ts: Date.now() });

  let dialogs = 0;
  const document = makePageDocument(INDEX_HTML);
  const w = makeEnv({
    storage,
    document,
    files: INDEX_FILES,
    url: "https://example.invalid/index.html",
    globals: {
      FileReader: FakeFileReader,
      dbWalletImportPreview: {
        chooseImportMode: async () => {
          dialogs++;
          // While the dialog is open, another tab resets "anna".
          const { ctx } = makeActionsCtx(tab2, S2.loadWallet("anna"));
          tab2.dbWalletActions.resetWallet(ctx);
          return "persist";
        },
      },
    },
  });
  await Promise.all(document._fire("DOMContentLoaded"));
  const input = document.getElementById("file-import");
  for (const fn of input.listeners.change) {
    fn({ target: { files: [{ _text: JSON.stringify(exported) }] } });
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

  assert.equal(dialogs, 1);
  assert.deepEqual(w._alerts, [], "no failure message: " + JSON.stringify(w._alerts));
  const reset = persisted(storage, "anna");
  assert.equal(reset.events.length, 0, "the reset wallet stays empty");
  assert.notEqual(reset.walletId, exported.walletId);
  // The pre-reset export lands as its own wallet (same rule as the hash import).
  const target = w._nav.pageLoads.at(-1) || "";
  const userId = decodeURIComponent(target.split("#")[1] || "");
  assert.ok(userId && userId !== "anna", "routed to a separate wallet: " + target);
  const imported = persisted(storage, userId);
  assert.equal(imported.walletId, exported.walletId);
  assert.equal(imported.events.length, 2);
});

test("saveWallet reports why it refused: replaced, quota, then cleared on success", () => {
  const storage = makeStorage();
  const tab1 = makeEnv({ storage, deviceKey: "devA" });
  const tab2 = makeEnv({ storage });
  const S1 = tab1.dbWalletStorage;
  const S2 = tab2.dbWalletStorage;
  const stale = S2.loadWallet("bob");
  S2.appendEvents(stale, [S2.newEvent(stale, "d", 1)]);
  const fresh = S1.loadWallet("bob");
  const { ctx } = makeActionsCtx(tab1, fresh);
  tab1.dbWalletActions.resetWallet(ctx);

  assert.equal(S2.saveWallet(stale, { quiet: true }), false);
  assert.equal(S2.getLastSaveError(), "replaced");
  assert.match(tab2.dbWalletImportV2.importSaveFailedMessage(), /anderen Tab/);

  storage.quota = 10;
  const again = S1.loadWallet("bob");
  assert.equal(S1.saveWallet(again, { quiet: true }), false);
  assert.equal(S1.getLastSaveError(), "quota");
  assert.match(tab1.dbWalletImportV2.importSaveFailedMessage(), /Speicher voll/);

  storage.quota = Infinity;
  assert.equal(S1.saveWallet(again, { quiet: true }), true);
  assert.equal(S1.getLastSaveError(), null);
});
