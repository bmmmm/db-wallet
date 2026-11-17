// P2.2: wallet.html without a usable hash is no dead end — it shows a link to
// the start page and the wallets on this device (E3: no auto-open), a broken
// import link ends in the same state, and a hash set afterwards opens a wallet.
// Visibility itself is CSS (body[data-no-wallet="1"] hides everything except
// #global-action-message); here we check the flag and the panel's content.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootWalletPage, flushHashChanges } = require("./wallet-page");
const { findAll } = require("./fake-dom");
const { plain, REPO } = require("./harness");

function seedTwo(e) {
  const S = e.dbWalletStorage;
  S.saveWallet(S.loadWallet("anna"));
  S.saveWallet(S.loadWallet("berta"));
}

function panel(w) {
  return w.document.getElementById("global-action-message");
}

function links(w) {
  const p = panel(w);
  return p ? findAll(p, (el) => el.tagName === "A").map((a) => a.href) : [];
}

test("no hash: no-wallet state with start-page link and the wallet list", async () => {
  const w = await bootWalletPage({ seed: seedTwo });
  assert.equal(w.document.body.dataset.noWallet, "1");
  const hrefs = links(w);
  assert.ok(hrefs.includes("index.html"), hrefs.join(" "));
  assert.ok(hrefs.includes("wallet.html#anna"), hrefs.join(" "));
  assert.ok(hrefs.includes("wallet.html#berta"), hrefs.join(" "));
  assert.equal(w.dbWalletUi, undefined, "no wallet is opened automatically (E3)");
});

test("no hash and no wallets: still a link to the start page", async () => {
  const w = await bootWalletPage({});
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.deepEqual(links(w), ["index.html"]);
});

test("broken #i2: link on a cold start ends in the no-wallet state", async () => {
  const w = await bootWalletPage({ seed: seedTwo, hash: "i2:AAAA" });
  await flushHashChanges(w);
  // Reported in the status line, which the no-wallet CSS leaves visible.
  assert.match(w.document.getElementById("status-text").textContent, /\S/, "the import error is reported");
  assert.ok(w.document.getElementById("status-line").classList.contains("is-error"));
  assert.deepEqual(plain(w._alerts), []);
  assert.equal(w.document.body.dataset.noWallet, "1");
  assert.ok(links(w).includes("wallet.html#anna"), links(w).join(" "));
});

test("a hash set after the no-wallet state opens that wallet", async () => {
  const w = await bootWalletPage({ seed: seedTwo });
  w.location.hash = "#anna";
  await flushHashChanges(w);
  // The no-wallet boot has no wallet UI wired; it reloads into the full boot.
  assert.deepEqual(w._nav.pageLoads, ["https://example.invalid/wallet.html#anna"]);
});

test("the no-wallet CSS keeps the status line visible", () => {
  const css = require("fs").readFileSync(require("path").join(REPO, "style.css"), "utf8");
  const rule = css.match(/body\[data-no-wallet="1"\] > ([^{]+)\{/);
  assert.ok(rule, "no-wallet rule present");
  assert.match(rule[1], /:not\(#global-action-message\)/);
  assert.match(rule[1], /:not\(#status-line\)/);
});
