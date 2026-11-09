// P3.6: the export link (classic link field and the QR link) gets "Kopieren"
// and, where navigator.share exists, "Teilen". Copy uses
// navigator.clipboard.writeText; if that is missing or rejects, the field is
// selected and document.execCommand("copy") is tried; if that fails too, the
// link stays selected with a German hint to copy it by hand. Share falls back
// to copy unless the user cancelled (AbortError). The QR canvas is drawn at
// devicePixelRatio with an integer number of device pixels per module, and all
// Blob downloads revoke their object URL late (one helper, not three copies).
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, BASE } = require("./wallet-page");
const { makeEnv } = require("./harness");

function seedOne(e) {
  const S = e.dbWalletStorage;
  const x = S.loadWallet("max");
  S.appendEvents(x, [S.newEvent(x, "d", 1)]);
}

async function waitFor(pred, what) {
  for (let i = 0; i < 500; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error("timeout waiting for " + what);
}

const settle = () => new Promise((r) => setTimeout(r, 5));

async function bootWithLink(kind, nav) {
  const w = await bootWalletPage({ hash: "max", seed: seedOne });
  w.navigator = nav || {};
  const doc = w.document;
  doc.getElementById("btn-export").click();
  if (kind === "qr") {
    doc.getElementById("btn-export-link-qr").click();
    await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  } else {
    doc.getElementById("btn-export-link").click();
  }
  return w;
}

const IDS = {
  classic: { field: "export-url", copy: "btn-copy-export-url", share: "btn-share-export-url", status: "export-url-status", row: "export-url-actions" },
  qr: { field: "qr-url", copy: "btn-copy-qr-url", share: "btn-share-qr-url", status: "qr-url-status" },
};

function clipboardFake(mode) {
  const writes = [];
  return {
    writes,
    clipboard: {
      writeText(t) {
        writes.push(t);
        return mode === "reject" ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
      },
    },
  };
}

for (const kind of ["classic", "qr"]) {
  const id = IDS[kind];

  test(`${kind}: Kopieren writes the link via navigator.clipboard`, async () => {
    const fake = clipboardFake("ok");
    const w = await bootWithLink(kind, { clipboard: fake.clipboard });
    const doc = w.document;
    const url = doc.getElementById(id.field).value;
    assert.ok(url.startsWith(BASE + "#"), url.slice(0, 60));
    if (id.row) assert.equal(doc.getElementById(id.row).style.display, "flex");
    doc.getElementById(id.copy).click();
    await settle();
    assert.deepEqual(fake.writes, [url]);
    assert.equal(doc.getElementById(id.status).textContent, "Link kopiert.");
    assert.equal(w._alerts.length, 0);
  });

  test(`${kind}: clipboard rejects → execCommand("copy") fallback`, async () => {
    const fake = clipboardFake("reject");
    const w = await bootWithLink(kind, { clipboard: fake.clipboard });
    const doc = w.document;
    const field = doc.getElementById(id.field);
    let selected = 0;
    field.select = () => selected++;
    const cmds = [];
    doc.execCommand = (c) => {
      cmds.push(c);
      return true;
    };
    doc.getElementById(id.copy).click();
    await settle();
    assert.equal(fake.writes.length, 1);
    assert.deepEqual(cmds, ["copy"]);
    assert.ok(selected > 0, "field selected before execCommand");
    assert.equal(doc.getElementById(id.status).textContent, "Link kopiert.");
  });

  test(`${kind}: neither clipboard nor execCommand → link selected, German hint`, async () => {
    const w = await bootWithLink(kind, {});
    const doc = w.document;
    const field = doc.getElementById(id.field);
    let selected = 0;
    field.select = () => selected++;
    doc.execCommand = () => false;
    doc.getElementById(id.copy).click();
    await settle();
    assert.ok(selected > 0);
    assert.match(doc.getElementById(id.status).textContent, /markiert.*selbst kopieren/);
  });

  test(`${kind}: Teilen only where navigator.share exists`, async () => {
    const w1 = await bootWithLink(kind, {});
    assert.equal(w1.document.getElementById(id.share).hidden, true);
    const shared = [];
    const w2 = await bootWithLink(kind, {
      share: (d) => {
        shared.push(d);
        return Promise.resolve();
      },
    });
    const doc = w2.document;
    const btn = doc.getElementById(id.share);
    assert.equal(btn.hidden, false);
    btn.click();
    await settle();
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, doc.getElementById(id.field).value);
    assert.equal(typeof shared[0].title, "string");
    assert.equal(doc.getElementById(id.status).textContent, "");
  });

  test(`${kind}: share cancelled → nothing; share fails → copy fallback`, async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    const fake = clipboardFake("ok");
    const w = await bootWithLink(kind, {
      clipboard: fake.clipboard,
      share: () => Promise.reject(abort),
    });
    const doc = w.document;
    doc.getElementById(id.share).click();
    await settle();
    assert.equal(fake.writes.length, 0, "a cancelled share does not copy");
    assert.equal(doc.getElementById(id.status).textContent, "");

    w.navigator.share = () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    doc.getElementById(id.share).click();
    await settle();
    assert.deepEqual(fake.writes, [doc.getElementById(id.field).value]);
    assert.equal(doc.getElementById(id.status).textContent, "Link kopiert.");
  });
}

test("hiding the export clears the link actions", async () => {
  const w = await bootWithLink("classic", {});
  const doc = w.document;
  doc.getElementById("btn-export").click(); // close
  assert.equal(doc.getElementById("export-url").style.display, "none");
  assert.equal(doc.getElementById("export-url-actions").style.display, "none");
  // A QR export replaces the classic link: its row goes too.
  const w2 = await bootWithLink("classic", {});
  w2.document.getElementById("btn-export-link-qr").click();
  await waitFor(() => w2.document.getElementById("qr-url").value, "qr url");
  assert.equal(w2.document.getElementById("export-url-actions").style.display, "none");
});

test("QR hint no longer promises copy-on-tap", async () => {
  const w = await bootWithLink("qr", {});
  const hint = w.document.getElementById("qr-hint").textContent;
  assert.doesNotMatch(hint, /Link=Kopieren/);
  assert.match(hint, /QR v\d+/);
});

test("sharp QR: backing store at devicePixelRatio, integer px per module", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOne });
  w.innerWidth = 400;
  w.devicePixelRatio = 3;
  const doc = w.document;
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  const canvas = doc.getElementById("qr-canvas");
  const url = doc.getElementById("qr-url").value;
  const qr = w.qrcodegen.QrCode.encodeText(url, w.qrcodegen.QrCode.Ecc.LOW);
  const modules = qr.size + 8;
  assert.equal(canvas.width % modules, 0);
  const cssPx = 400 - 48;
  assert.ok(canvas.width > cssPx * 2, `backing ${canvas.width} not scaled by dpr`);
  assert.ok(canvas.width <= cssPx * 3);
  // CSS size = backing / dpr, so one module is exactly width/modules device px.
  assert.equal(canvas.style.width, canvas.width / 3 + "px");
});

test("sharp QR: no devicePixelRatio → 1, CSS width = backing width", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOne });
  w.innerWidth = 400;
  const doc = w.document;
  doc.getElementById("btn-export-link-qr").click();
  await waitFor(() => doc.getElementById("qr-url").value, "qr url");
  const canvas = doc.getElementById("qr-canvas");
  assert.ok(canvas.width <= 352);
  assert.equal(canvas.style.width, canvas.width + "px");
});

// --- late revoke of Blob URLs ------------------------------------------------

function trackUrls(w) {
  const created = [];
  const revoked = [];
  const timers = [];
  class U extends URL {}
  U.createObjectURL = () => {
    const u = "blob:fake/" + created.length;
    created.push(u);
    return u;
  };
  U.revokeObjectURL = (u) => revoked.push(u);
  w.URL = U;
  const realSetTimeout = w.setTimeout;
  w.setTimeout = (fn, ms, ...a) => {
    timers.push({ fn, ms });
    return realSetTimeout(() => {}, 0, ...a);
  };
  return { created, revoked, timers };
}

test("helpers.downloadBlob revokes the object URL late, not immediately", () => {
  const { makeFakeDocument } = require("./fake-dom");
  const w = makeEnv({ document: makeFakeDocument() });
  const t = trackUrls(w);
  const H = w.dbWalletHelpers;
  assert.equal(typeof H.downloadBlob, "function");
  H.downloadBlob(new Blob(["x"]), "a.json");
  assert.equal(t.created.length, 1);
  assert.deepEqual(t.revoked, [], "revoked synchronously");
  const timer = t.timers.find((x) => x.ms >= H.BLOB_URL_REVOKE_MS);
  assert.ok(timer, JSON.stringify(t.timers.map((x) => x.ms)));
  assert.ok(H.BLOB_URL_REVOKE_MS >= 1000);
  timer.fn();
  assert.deepEqual(t.revoked, t.created);
  assert.equal(w.document.body.children.length, 0, "link removed again");
});

test("JSON download goes through the late-revoke helper", async () => {
  const w = await bootWalletPage({ hash: "max", seed: seedOne });
  const t = trackUrls(w);
  w.document.getElementById("btn-export-json").click();
  assert.equal(t.created.length, 1);
  assert.deepEqual(t.revoked, []);
});

test("no shipped script revokes an object URL right after click()", () => {
  const fs = require("fs");
  const path = require("path");
  const { REPO } = require("./harness");
  for (const f of ["wallet-ui.js", "action-codes.js", "wallet-export-ui.js"]) {
    const src = fs.readFileSync(path.join(REPO, f), "utf8");
    assert.doesNotMatch(src, /revokeObjectURL/, f + " should use helpers.downloadBlob");
  }
});
