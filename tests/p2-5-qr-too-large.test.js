// P2.5: when the export no longer fits a version-40 QR, the compact i2: link
// is offered in the link field instead of being thrown away.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, BASE } = require("./wallet-page");
const { makeEnv } = require("./harness");

function seed700(e) {
  const S = e.dbWalletStorage;
  const wallet = S.loadWallet("max");
  const evs = [];
  // Irregular minutes and amounts so gzip can't squeeze it into one QR.
  let ts = 1700000000000;
  let x = 12345;
  for (let i = 0; i < 700; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    ts += 60000 * (1 + (x % 997));
    const ev = S.newEvent(wallet, i % 9 === 0 ? "g" : "d", 1 + (x % 7));
    ev.ts = ts;
    evs.push(ev);
  }
  assert.equal(S.appendEvents(wallet, evs), true);
}

async function waitFor(pred, what) {
  for (let i = 0; i < 500; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timeout waiting for " + what);
}

test("700 events: QR too large, export offers a working i2: link", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seed700 });
  const doc = w.document;
  const linkField = doc.getElementById("export-url");
  w.console = Object.assign({}, console, { error() {} }); // expected "Data too long" log
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => w._alerts.length > 0 || linkField.value, "export result");

  assert.equal(doc.getElementById("qr-box").style.display, "none", "no QR rendered");
  assert.ok(linkField.value.startsWith(BASE + "#i2:"), linkField.value.slice(0, 80));
  assert.equal(linkField.style.display, "block");
  assert.equal(w._alerts.length, 1, JSON.stringify(w._alerts));
  assert.match(w._alerts[0], /kompakte/);

  // The offered link imports all 700 events on another device.
  const other = makeEnv({ deviceKey: "devB" });
  other.location.href = linkField.value;
  const res = await other.dbWalletImportV2.tryImportFromHash({});
  assert.equal(res.userId, "max");
  assert.equal(other.dbWalletStorage.loadWallet("max").events.length, 700);
});

test("small wallet: QR still rendered, link field stays empty (baseline)", async () => {
  const w = await bootWalletPage({
    hash: "mini",
    seed: (e) => {
      const S = e.dbWalletStorage;
      const x = S.loadWallet("mini");
      S.appendEvents(x, [S.newEvent(x, "d", 1)]);
    },
  });
  const doc = w.document;
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  assert.equal(doc.getElementById("qr-box").style.display, "flex");
  assert.equal(doc.getElementById("export-url").value, "");
  assert.equal(w._alerts.length, 0);
});
