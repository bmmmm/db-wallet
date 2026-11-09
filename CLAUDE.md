# db-wallet

Browser-only Getränke-Wallet — kein Backend, kein Server, alles lokal im Browser.
PWA (Progressive Web App) für Getränke-Tracking und -Verwaltung.

## Identity

Commits use the repo's configured git identity (GitHub user `bmmmm`). `origin` is the
self-hosted Forgejo (source of truth); `github` is the public mirror remote — push both:
`git push origin main && git push github main`. Real hosts/tokens live in `~/.env` /
`~/ops/runbooks/identity-setup.md` — not in tracked source.

## Conventions

- Cross-repo notes, runbooks, audits: `~/ops/`
- Per-repo intent (current focus, blockers, next): `~/ops/projects/db-wallet.md`

## Tech Stack

- **Vanilla HTML/CSS/JS** — kein Framework, kein Build-Tool, kein npm
- **PWA** — `manifest.json` + Service Worker (`sw-register.js`)
- **Lokaler Storage** — kein Backend, keine API-Calls

## Local Dev

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Kein Build-Schritt. Direkt die HTML-Dateien bearbeiten.

Logic tests in Node (no npm, only `node:test`/`node:vm`; CI runs the same command):

```bash
node --test tests/
```

`tests/harness.js` loads the original modules into a `vm` context with a fresh
`localStorage` per `makeEnv()` (`quota` simulates full storage — also settable later via
`storage.quota`; `deviceKey` pins the device; `storage` shares one store between two
"tabs"; `files` picks the modules). Every env has a fake `location`/`history`
(`w._nav`): assigning `location.hash` pushes an entry and queues a `hashchange`
(delivered by `w._nav.flush()`), `history.replaceState` rewrites the current entry
silently, navigations to another page land in `w._nav.pageLoads`.
`tests/fake-dom.js` is a minimal DOM (createElement, a children tree, listeners,
`click()`, no layout) for the action-code panel; its `makePageDocument(html)` creates one
flat element per id/class of a real page. `tests/wallet-page.js` boots `wallet.html`'s
scripts in page order on that DOM (`bootWalletPage`, `flushHashChanges`).
`tests/actions-ctx.js` is a DOM-free ctx stub for `dbWalletActions`.
vm objects have foreign prototypes — compare via `plain()`/JSON, not `deepStrictEqual`.
`tests/` is not deployed (Pages copies an allowlist).

Verify browser-only changes: open `wallet.html` and run `await dbWalletSelfCheck.run()` in the console
(returns `{ok, checks}`). Caveat: the Service Worker caches the app shell cache-first and
CSP blocks `eval`, so a normal reload serves stale scripts after an edit — unregister the
SW + clear caches, or serve on a fresh port. That alone is NOT enough: the re-registering
SW's `cache.addAll` fetches through the browser HTTP cache (python's http.server sends no
cache headers → heuristic caching), so it re-caches the stale copy. After an edit, force
the HTTP cache fresh first: `await fetch("<file>.js", {cache: "reload"})`, then unregister
+ clear + reload. Also: automation tabs are usually hidden — `requestAnimationFrame` never
fires there, so rAF-deferred UI work looks broken under browser automation.

## Key files

| Datei | Rolle |
|-------|-------|
| `wallet.html` | Haupt-Wallet-Ansicht |
| `index.html` | Startseite |
| `wallet-actions.js` | Buchungslogik — Drink/Undo/Pay/Credit/Edit/Delete (**hier editieren**) |
| `wallet-storage.js` | localStorage, Event-IDs, Tombstones, Wallet-Registry |
| `wallet-summary.js` | Zusammenfassung / Balance-Berechnung |
| `wallet-import-v2.js` | Binär-QR-Codec (encode/decode), Import-Merge |
| `action-codes.js` | QR-Action-Codes (lokal/global) |
| `wallet-sync.js` | Wallet-Sync-Logik |
| `wallet-history-ui.js` | Verlaufs-UI |
| `wallet-device-ui.js` | Geräte-UI |
| `wallet-helpers.js` | Shared Helpers (base64url, gzip, IDs, Hashing, `formatDate`/`formatDateTime`, `normalizeUserId`, `drawQrToCanvas`); canonical event comparator (`cmpEventId`/`compareEventsByTime`) + `DEVICE_SYMBOLS` |
| `migration.js` | Datenmigration v1→v2 |
| `hash-router.js` | Client-seitiges Routing via URL-Hash |
| `self-check.js` | In-Browser-Testsuite (`dbWalletSelfCheck.run()`) |
| `manifest.json` | PWA Manifest |
| `themes.css` / `colors.css` | Theme-System |

## Gotchas

- **Event model is append-only** — never mutate an event in place (the import/sync
  merge dedups strictly by `id`). Operations:
  - drink/credit/pay → append a new event.
  - delete/undo → append a tombstone (`t:"x"`, `ref` = the entry's **root** id).
  - edit → append a replacement carrying `supersedes` = root id (no tombstone). The
    summary fold (`applyTombstones`) collapses every replacement of one root to the
    canonical-last winner, so concurrent edits on two devices converge instead of
    double-counting; a delete of the root wins over a concurrent edit. The
    `supersedes` link round-trips via the `se` codec extension block.
  - Order: sort by `ts`, tie-break by numeric base36 seq (not lexical).
- **Undo is monotonic** — it removes the last *visible* entry (tombstoning its root);
  it does not revert a deletion (that would ping-pong with its own tombstones). It
  confirms when the previous action was a deletion. `applyTombstones` still treats a
  tombstone-of-a-tombstone as an un-delete for data/merge robustness.
- **QR export is minute-resolution + a bearer credential** — `tsMs` is quantized to
  the minute on encode (order-preserving, balance-neutral; sub-minute order is rebuilt
  from payload position). The export QR/link carries the full event log, userId, and
  action-code keys with no encryption — anyone who captures it can replay it.
- **Codec extension blocks are order-sensitive** — they have no length prefix, so an
  old decoder stops at the first unknown block. New blocks (`se`, `gc`, `ck`) are written
  LAST and `ck` (integrity checksum) is absolutely last so it covers everything. `gc`
  carries `globalActionCodes` with an empty key field — global codes have no key
  (`normalizeGlobalActionCodes`: scope "global", no key, amount 1..100); decode drops
  the random key that pre-2026-11 exports wrote there, so old exports still import.
- **Events are constructed and persisted only via `dbWalletStorage`** —
  `newEvent(wallet, type, n)` is the single event factory and
  `appendEvents(wallet, events)` the atomic append+save (rolls back and returns
  `false` on save failure); don't hand-roll event literals or snapshot/restore.
  `saveWallet` reconciles with the persisted state: colliding same-id events from a
  second tab are re-minted (no silent drop) — only on this device's own `deviceKey`;
  on a foreign id the persisted copy wins — and actionCodes/globalActionCodes/devices
  are merged field-wise. Every event passes through `normalizeEvent` (loadWallet,
  both sides of the saveWallet compare, import with a field whitelist); the amount
  ceiling is `dbWalletHelpers.MAX_EVENT_AMOUNT` (1e9), enforced at every input. `undoLastEvent` returns the tombstone, `null` (nothing to
  undo), or `{status:"failed"}` (save failure).
- **Action codes never expire; the key is the only secret** — revocation = edit (key
  rotation) or delete. An imported code can update label/amount/type but never the
  local key (key rotation is local-only). A global `acg:` apply asks for confirmation.
  Deleting a code (local or global, also the old half of a local↔global conversion)
  goes through `dbWalletActionCodes.removeActionCode`, which records `id → ts` in
  `wallet.deletedActionCodes` (local-only, newest 50, not exported). `saveWallet`'s
  reconcile and the import merge filter those ids, so a stale tab or an old export
  can't resurrect a deleted code. Don't splice `actionCodes` by hand.
- **Reset = a new wallet under the same name** — `resetWallet` assigns a fresh
  `walletId` (a pre-reset export imports as a separate wallet) and carries `seq`
  over after `ensureDeviceSeq`, so an event id is never re-issued. Don't reset `seq`.
  `saveWallet` refuses (returns `false`, one-time "in einem anderen Tab
  zurückgesetzt" alert) when the in-memory and persisted `walletId` differ (both
  non-empty) — a stale tab must not merge old events into the reset wallet. Only a
  save that intentionally switches the `walletId` (today: `resetWallet`) passes
  `{ allowWalletIdChange: true }`, which overwrites without reconciling. Exception:
  a `walletId` that `loadWallet` minted (nothing stored, or a legacy record without
  one) and that was never saved adopts the persisted one, as long as the stored log
  still holds every event it was loaded with (two tabs opening a new wallet). A reset
  replaces the stored record (never removes it first); if that save fails, the tab
  and the store keep the old wallet and the user gets "Zurücksetzen fehlgeschlagen".
- **Load order is load-bearing** — every module is a `window.dbWalletX` IIFE that
  early-returns if a dependency namespace is missing; keep the `<script>` order in `wallet.html`.
- **Bump `service-worker.js` VERSION when any APP_SHELL asset changes** — enforced by
  `scripts/check-sw-version.sh` + the `sw-version` GitHub Action.
