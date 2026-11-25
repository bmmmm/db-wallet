// O3.5: the export QR is sized from the measured width of #qr-box (not from
// innerWidth - 48), so on a narrow phone the canvas is never squeezed by
// `max-width: 100%` and every module stays an integer number of device
// pixels. A resize (rotation) redraws the shown code.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage } = require("./wallet-page");
const { waitFor } = require("./harness");

function seedOne(e) {
  const S = e.dbWalletStorage;
  const x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 1)]);
}

// A 360 px phone at dpr 2: the panels leave 272 px for #qr-box (measured in
// the browser before the fix), 12 px padding on each side.
async function bootNarrow() {
  const w = await bootWalletPage({ hash: "max", seed: seedOne });
  w.innerWidth = 360;
  w.devicePixelRatio = 2;
  w.getComputedStyle = () => ({ paddingLeft: "12px", paddingRight: "12px" });
  const doc = w.document;
  doc.getElementById("qr-box").clientWidth = 272;
  doc.getElementById("btn-export").click();
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  return w;
}

function modulesOf(w) {
  const url = w.document.getElementById("qr-url").value;
  return w.qrcodegen.QrCode.encodeText(url, w.qrcodegen.QrCode.Ecc.LOW).size + 8;
}

test("narrow screen: the QR fits the measured box at integer device px per module", async () => {
  const w = await bootNarrow();
  const canvas = w.document.getElementById("qr-canvas");
  const modules = modulesOf(w);
  const cssWidth = parseFloat(canvas.style.width);
  assert.equal(canvas.width % modules, 0);
  assert.equal(cssWidth, canvas.width / 2, "CSS width = backing / dpr");
  assert.ok(cssWidth <= 272 - 24, `CSS width ${cssWidth} exceeds the box content (248)`);
  assert.ok(canvas.width / modules >= 2, "at least 2 device px per module");
});

test("resize redraws the shown QR for the new box width", async () => {
  const w = await bootNarrow();
  const doc = w.document;
  const canvas = doc.getElementById("qr-canvas");
  const before = canvas.width;
  doc.getElementById("qr-box").clientWidth = 200;
  w._dispatch("resize");
  await waitFor(() => canvas.width !== before, "redraw after resize");
  const cssWidth = parseFloat(canvas.style.width);
  assert.ok(cssWidth <= 200 - 24, `CSS width ${cssWidth} after resize`);
  assert.equal(canvas.width % modulesOf(w), 0);
});
