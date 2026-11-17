// P5.4: one canonical event order on every device. The QR export keeps only
// the minute of a timestamp, so an imported event's sub-minute time is made up
// (its position in the payload) while the device's own events keep
// milliseconds — the order must not depend on that part.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeEnv, plain } = require("./harness");
const { makeActionsCtx } = require("./actions-ctx");

const MIN = 60000;

function summary(w, wallet) {
  return plain(w.dbWalletSummary.computeSummary(wallet));
}

// Export `from`'s wallet and import it on `to` (codec round trip + save).
function sync(from, to, userId) {
  const bytes = from.dbWalletImportV2.encodeImportV2Bytes(
    from.dbWalletStorage.loadWallet(userId),
    "",
  );
  const remote = to.dbWalletImportV2.decodeImportV2Bytes(bytes);
  const built = to.dbWalletImportV2.buildImportedWallet(remote);
  to.dbWalletStorage.ensureDeviceSeq(built.wallet);
  assert.equal(to.dbWalletStorage.saveWallet(built.wallet), true);
}

function book(w, userId, type, n, ts) {
  const S = w.dbWalletStorage;
  const wallet = S.loadWallet(userId);
  const ev = S.newEvent(wallet, type, n);
  ev.ts = ts;
  assert.equal(S.appendEvents(wallet, [ev]), true);
  return ev;
}

// A whole minute, an hour ago (sub-minute offsets stay inside it).
function baseMinute() {
  return Math.floor((Date.now() - 3600000) / MIN) * MIN;
}

test("A7: a pay and a drink in the same minute on two devices converge", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  const m = baseMinute();
  book(a, "anna", "d", 1, m - 3600000);
  sync(a, b, "anna");
  book(a, "anna", "p", undefined, m + 10000);
  book(b, "anna", "d", 1, m + 5000);
  sync(a, b, "anna");
  sync(b, a, "anna");
  const sa = summary(a, a.dbWalletStorage.loadWallet("anna"));
  const sb = summary(b, b.dbWalletStorage.loadWallet("anna"));
  assert.equal(sa.unpaid, sb.unpaid, "both devices show the same open drinks");
  assert.equal(sa.total, sb.total);
  assert.equal(sa.credit, sb.credit);
});

test("A7 both ways round: the order does not depend on who booked first", () => {
  for (const [payDev, drinkDev] of [["a", "b"], ["b", "a"]]) {
    const envs = { a: makeEnv({ deviceKey: "devA" }), b: makeEnv({ deviceKey: "devB" }) };
    const m = baseMinute();
    book(envs.a, "anna", "d", 2, m - 3600000);
    sync(envs.a, envs.b, "anna");
    book(envs[payDev], "anna", "p", undefined, m + 40000);
    book(envs[drinkDev], "anna", "d", 1, m + 1000);
    sync(envs.a, envs.b, "anna");
    sync(envs.b, envs.a, "anna");
    const sa = summary(envs.a, envs.a.dbWalletStorage.loadWallet("anna"));
    const sb = summary(envs.b, envs.b.dbWalletStorage.loadWallet("anna"));
    assert.equal(sa.unpaid, sb.unpaid, `pay on ${payDev}`);
  }
});

test("edits of one entry on two devices converge to one winner", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  const m = baseMinute();
  const root = book(a, "anna", "d", 1, m + 30000);
  sync(a, b, "anna");
  // Both move it to the day before: A keeps its milliseconds, B only has the
  // minute — each device's own replacement must not win just locally.
  const date = a.dbWalletSummary.dateStrFromTimestamp(root.ts - 86400000);
  const ea = makeActionsCtx(a, a.dbWalletStorage.loadWallet("anna"));
  assert.equal(a.dbWalletActions.editEntry(ea.ctx, root.id, { date, amount: "3" }), true);
  const eb = makeActionsCtx(b, b.dbWalletStorage.loadWallet("anna"));
  assert.equal(b.dbWalletActions.editEntry(eb.ctx, root.id, { date, amount: "5" }), true);
  sync(a, b, "anna");
  sync(b, a, "anna");
  const sa = summary(a, a.dbWalletStorage.loadWallet("anna"));
  const sb = summary(b, b.dbWalletStorage.loadWallet("anna"));
  assert.equal(sa.total, sb.total, "one winner on both devices");
});

test("a second edit wins even when it moves the entry further back", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const day = 86400000;
  const root = book(w, "anna", "d", 1, Date.now() - 2 * day);
  const dateOf = (ts) => w.dbWalletSummary.dateStrFromTimestamp(ts);
  let e = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.editEntry(e.ctx, root.id, { date: dateOf(root.ts - day), amount: "2" }), true);
  e = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.editEntry(e.ctx, root.id, { date: dateOf(root.ts - 2 * day), amount: "4" }), true);
  const wallet = S.loadWallet("anna");
  const s = summary(w, wallet);
  assert.equal(s.total, 4, "the latest edit is the visible one");
  const visible = plain(w.dbWalletSummary.applyTombstones(wallet.events).effectiveEvents);
  assert.equal(visible.length, 1);
  assert.equal(dateOf(visible[0].ts), dateOf(root.ts - 2 * day));
});

test("an amount edit keeps its place before a later pay of the same minute", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const m = baseMinute();
  const drink = book(w, "anna", "d", 1, m + 10000);
  book(w, "anna", "p", undefined, m + 40000);
  const date = w.dbWalletSummary.dateStrFromTimestamp(drink.ts);
  const e = makeActionsCtx(w, S.loadWallet("anna"));
  assert.equal(w.dbWalletActions.editEntry(e.ctx, drink.id, { date, amount: "3" }), true);
  const s = summary(w, S.loadWallet("anna"));
  assert.equal(s.total, 3);
  assert.equal(s.unpaid, 0, "the edited drink stays before the pay");
});

test("an edit of another device's edit wins on both devices, even moved back", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  const day = 86400000;
  const dateOf = (ts) => a.dbWalletSummary.dateStrFromTimestamp(ts);
  // B has many events, so its seq is far ahead of A's.
  for (let i = 0; i < 12; i++) book(b, "anna", "g", 1, Date.now() - 10 * day + i * MIN);
  const root = book(b, "anna", "d", 1, Date.now() - 2 * day);
  let e = makeActionsCtx(b, b.dbWalletStorage.loadWallet("anna"));
  assert.equal(b.dbWalletActions.editEntry(e.ctx, root.id, { date: dateOf(root.ts - day), amount: "2" }), true);
  sync(b, a, "anna");
  // A edits B's edit afterwards and moves it further back.
  e = makeActionsCtx(a, a.dbWalletStorage.loadWallet("anna"));
  assert.equal(a.dbWalletActions.editEntry(e.ctx, root.id, { date: dateOf(root.ts - 2 * day), amount: "4" }), true);
  assert.equal(summary(a, a.dbWalletStorage.loadWallet("anna")).total, 4, "A sees its own edit at once");
  sync(a, b, "anna");
  assert.equal(summary(b, b.dbWalletStorage.loadWallet("anna")).total, 4, "B takes A's later edit");
});

test("an edit does not lift the counter above a crafted or migrated seq", () => {
  const w = makeEnv({ deviceKey: "devA" });
  const S = w.dbWalletStorage;
  const root = book(w, "anna", "d", 1, Date.now() - 3 * 86400000);
  const wallet = S.loadWallet("anna");
  const crafted = { id: "devX." + (2 ** 45).toString(36), t: "d", n: 9, ts: root.ts, supersedes: root.id };
  const migrated = { id: "legacy." + (2 ** 30).toString(36), oid: "legacy-1-x", t: "d", n: 8, ts: root.ts, supersedes: root.id };
  assert.equal(S.appendEvents(wallet, [crafted, migrated]), true);
  const ev = S.newEvent(S.loadWallet("anna"), "d", 2, { supersedes: root.id });
  assert.equal(ev.supersedes, root.id);
  const seq = w.dbWalletHelpers.parseCompactEventId(ev.id).seq;
  assert.ok(seq < 100, `seq stays small, got ${seq}`);
});

test("undo still asks after a delete when a foreign event of that minute sorts last", () => {
  const a = makeEnv({ deviceKey: "devA" });
  const b = makeEnv({ deviceKey: "devB" });
  book(a, "anna", "d", 1, Date.now() - 3600000);
  const mine = book(a, "anna", "d", 1, Date.now() - 1800000);
  sync(a, b, "anna");
  // B's clock runs ahead: its booking lands after A's newest event.
  book(b, "anna", "d", 1, Date.now() + 120000);
  sync(b, a, "anna");
  const S = a.dbWalletStorage;
  const { ctx } = makeActionsCtx(a, S.loadWallet("anna"));
  assert.equal(a.dbWalletActions.deleteEntry(ctx, mine.id), true);
  const wallet = S.loadWallet("anna");
  const sorted = wallet.events.slice().sort(a.dbWalletHelpers.compareEventsByTime);
  assert.notEqual(sorted[sorted.length - 1].t, "x", "the foreign event sorts after the tombstone");
  const plan = S.resolveUndoTarget(wallet);
  assert.equal(plan.afterDeletion, true);
});

test("the codec writes events in canonical order", () => {
  const w = makeEnv({ deviceKey: "devB" });
  const S = w.dbWalletStorage;
  const m = baseMinute();
  const wallet = S.loadWallet("anna");
  const evs = [];
  for (const [dev, seq, off, t] of [["devB", 1, 50000, "d"], ["devA", 2, 1000, "p"], ["devA", 1, 59000, "d"], ["devC", 1, 0, "g"]]) {
    evs.push({ id: `${dev}.${seq}`, t, n: t === "p" ? undefined : 1, ts: m + off });
  }
  wallet.events = evs;
  const remote = w.dbWalletImportV2.decodeImportV2Bytes(w.dbWalletImportV2.encodeImportV2Bytes(wallet, ""));
  assert.deepEqual(plain(remote.events.map((e) => e.id)), ["devA.1", "devA.2", "devB.1", "devC.1"]);
  assert.deepEqual(plain(remote.events.map((e) => e.ts - m)), [0, 1, 2, 3]);
});
