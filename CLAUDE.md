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

Verify changes: open `wallet.html` and run `await dbWalletSelfCheck.run()` in the console
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
  carries `globalActionCodes` (incl. keys — bearer credential, like `ac`).
- **Events are constructed and persisted only via `dbWalletStorage`** —
  `newEvent(wallet, type, n)` is the single event factory and
  `appendEvents(wallet, events)` the atomic append+save (rolls back and returns
  `false` on save failure); don't hand-roll event literals or snapshot/restore.
  `saveWallet` reconciles with the persisted state: colliding same-id events from a
  second tab are re-minted (no silent drop), and actionCodes/globalActionCodes/devices
  are merged field-wise. `undoLastEvent` returns the tombstone, `null` (nothing to
  undo), or `{status:"failed"}` (save failure).
- **Action codes never expire; the key is the only secret** — revocation = edit (key
  rotation) or delete. An imported code can update label/amount/type but never the
  local key (key rotation is local-only). A global `acg:` apply asks for confirmation.
- **Load order is load-bearing** — every module is a `window.dbWalletX` IIFE that
  early-returns if a dependency namespace is missing; keep the `<script>` order in `wallet.html`.
- **Bump `service-worker.js` VERSION when any APP_SHELL asset changes** — enforced by
  `scripts/check-sw-version.sh` + the `sw-version` GitHub Action.
