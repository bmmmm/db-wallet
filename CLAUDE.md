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
(returns `{ok, checks}`). Caveat: the Service Worker serves scripts/CSS cache-first (pages
network-first with a 3 s timeout) and CSP blocks `eval`, so a normal reload serves stale
scripts after an edit — unregister the SW + clear caches, or serve on a fresh port. The
precache requests use `cache: "reload"` (since P3.4), so a re-registering SW no longer
re-caches a stale HTTP-cache copy; the page's own `<script>` loads still go through the
HTTP cache (python's http.server sends no cache headers → heuristic caching), so if in
doubt `await fetch("<file>.js", {cache: "reload"})` first. Also: automation tabs are usually hidden — `requestAnimationFrame` never
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
| `action-codes.js` | QR-Action-Codes (lokal/global): Normalisierung, Merge, Hash-Codec, Löschliste und die Änderungen als reine Funktionen (`createActionCode`/`editActionCode`/`deleteActionCode`, `(wallet, change) → {wallet}`) |
| `action-codes-ui.js` | Action-Code-Panel (DOM, nur `wallet.html`): Karten, QR, Formulare; speichert jede Änderung einmal |
| `wallet-sync.js` | Sync-Ampel + ASCII-Timeline (pure) |
| `wallet-ui.js` | Composer von `wallet.html`: Hash klassifizieren → Wallet laden → Module initialisieren; Hash-/Storage-Events |
| `wallet-export-ui.js` | Export: QR-Link (`#i2:`/`#i2u:`), JSON-Backup, PNG; ohne QR-Bibliothek steht der Link in `#export-url` |
| `wallet-sync-ui.js` | Sync-Zeile (nur mit Sync-Partner) |
| `wallet-hash-actions.js` | Wallet-Auswahl und Hinweise für `#acg:` ohne/mit mehreren Wallets |
| `wallet-messages.js` | Hinweisblock nach dem Seitenkopf (`#wallet-header`/`#index-header`): No-Wallet, Speicherfehler-Banner |
| `index-ui.js` | Startseite; einziger Export `dbWalletIndexUI.hashFromPastedLink` |
| `import-preview.js` / `preview.html` | Read-only-Vorschau eines Imports (nichts gespeichert) |
| `theme.js` | Theme-Wahl; schreibt auch `#current-theme-name` bei jedem Wechsel |
| `wallet-history-ui.js` | Verlaufs-UI: Diagramm/Raw im `<pre>`, „Historie" als Zeilen (`#history-list`, 200 je Schritt) mit Bearbeiten (Inline-Formular) / Löschen pro Eintrag |
| `wallet-device-ui.js` | Geräte-UI |
| `wallet-helpers.js` | Shared Helpers (base64url, gzip, IDs, Hashing, `formatDate`/`formatDateTime`, `normalizeUserId`, `drawQrToCanvas` + `loadQrLibrary` (injects `qrcodegen.js` on first use — no page loads it; the action-code panel draws its QRs only while `#action-codes-panel` is open), `downloadBlob` = the one Blob-download path, revokes late (`downloadJson` builds on it); `notify`/`confirmDialog`/`whenConfirmed`; shared UI steps `selectField`, `downloadCanvasPng`, `safeFilePart`, `onEnterOrSpace`; `RESERVED_HASH_PREFIXES`/`isReservedHashPrefix`); canonical event comparator (`cmpEventId`/`compareEventsByTime`) + `DEVICE_SYMBOLS` |
| `migration.js` | Datenmigration v1→v2 |
| `hash-router.js` | `classifyHash` — der einzige Hash-Klassifizierer (`#<name>`, `ac:`/`acg:`/`import:`/`i2:`/`i2u:`) |
| `self-check.js` | In-Browser-Testsuite (`dbWalletSelfCheck.run()`), lazy-loaded |
| `self-check-loader.js` | Stub on `wallet.html`: `dbWalletSelfCheck.run()` loads `self-check.js` on first call |
| `manifest.json` | PWA Manifest |
| `themes.css` | Theme-Paletten (Lilac Carbon nur dort, als `:root`-Default) |

## Gotchas

- **Event model is append-only** — never mutate an event in place (the import/sync
  merge dedups strictly by `id`). Operations:
  - drink/credit/pay → append a new event.
  - delete/undo → append a tombstone (`t:"x"`, `ref` = the entry's **root** id).
  - edit → append a replacement carrying `supersedes` = root id (no tombstone),
    minted by `newEvent(wallet, t, n, { supersedes: root })`. The summary fold
    (`applyTombstones`) collapses every replacement of one root to the latest edit
    (`helpers.compareEdits`: the highest seq, tie the larger deviceKey — not the
    latest `ts`, an edit may move an entry back); `newEvent` lifts the device
    counter above every seq of the chain, so an edit beats what it replaced on
    every device and concurrent edits converge. A delete of the root wins over a
    concurrent edit. The `supersedes` link round-trips via the `se` codec block.
  - Order (`compareEventsByTime`, P5.4): the **minute** of `ts`, then the root id,
    then the id (`cmpEventId`: deviceKey, then numeric base36 seq — not lexical).
    Milliseconds never decide (an imported event's sub-minute time is made up), so
    every device sorts alike; an edit with the same `ts` keeps the original's place.
- **Undo is monotonic** — it removes the last *visible* entry (tombstoning its root);
  it does not revert a deletion (that would ping-pong with its own tombstones). It
  confirms when the previous action was a deletion (this device's newest event, the
  highest own seq, is a delete tombstone). `applyTombstones` still treats a
  tombstone-of-a-tombstone as an un-delete for data/merge robustness.
- **QR export is minute-resolution + a bearer credential** — `tsMs` is quantized to
  the minute on encode (balance-neutral: the order is by minute + ids anyway; events
  are written in canonical order and decode at minute + position; tombstones decode
  at the full minute — their ts counts nowhere, P5.5). The export
  QR/link carries the full event log, userId, and action-code keys with no
  encryption — anyone who captures it can replay it.
- **Codec extension blocks are order-sensitive** — they have no length prefix, so an
  old decoder stops at the first unknown block. New blocks (`se`, `gc`, `dc`, `ck`) are
  written LAST and `ck` (integrity checksum) is absolutely last so it covers everything. `gc`
  carries `globalActionCodes` with an empty key field — global codes have no key
  (`normalizeGlobalActionCodes`: scope "global", no key, amount 1..100); decode drops
  the random key that pre-2026-11 exports wrote there, so old exports still import.
  `dc` carries `deletedActionCodes` (`id → ts`). A version bump of a block an old
  decoder knows makes it stop there too: tombstones (`xt` v2 since P5.5: minute
  delta + device index/seq, `writeIdRef`/`readIdRef`) would be lost silently, so a
  payload with tombstones says codec 3 in the header (an old app refuses it as
  "neuere App-Version"); without tombstones it stays codec 2, byte for byte. The
  decoder still reads `xt` v1 (exact ms).
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
  `wallet.deletedActionCodes` (newest 50, times capped at now). The list travels in
  exports (codec block `dc`, JSON field) and an import unions it with the local one
  before merging codes, so a code deleted on one device disappears on the others.
  `saveWallet`'s reconcile and the import merge filter those ids, so a stale tab or an
  old export can't resurrect a deleted code. Don't splice `actionCodes` by hand.
- **Reset = a new wallet under the same name** — `resetWallet` assigns a fresh
  `walletId` (a pre-reset export imports as a separate wallet) and carries `seq`
  over after `ensureDeviceSeq`, so an event id is never re-issued. Don't reset `seq`.
  `saveWallet` refuses (returns `false`, one-time "in einem anderen Tab
  zurückgesetzt" notice with a "Neu laden" button, `notifyWalletReplaced`) when the in-memory and persisted `walletId` differ (both
  non-empty) — a stale tab must not merge old events into the reset wallet. Only a
  save that intentionally switches the `walletId` (today: `resetWallet`) passes
  `{ allowWalletIdChange: true }`, which overwrites without reconciling. Exception:
  a `walletId` that `loadWallet` minted (nothing stored, or a legacy record without
  one) and that was never saved adopts the persisted one, as long as the stored log
  still holds every event it was loaded with (two tabs opening a new wallet). A reset
  replaces the stored record (never removes it first); if that save fails, the tab
  and the store keep the old wallet and the user gets "Zurücksetzen fehlgeschlagen".
- **Notices go to the status line, not `alert()`** — `dbWalletHelpers.notify(text,
  {kind:"error", sticky, action:{label, run}})` writes `#status-line` (on
  `wallet.html` and `index.html`; `#status-text` is the page's one `role="status"`,
  always in the DOM, shown via `.is-visible`, so the no-wallet CSS must keep it).
  Without the line it falls back to `alert()`. Showing a notice scrolls the
  focused element clear of the fixed line, so focus the field an error is
  about *before* calling `notify`. Keep `alert()` only for a message
  right before a navigation away (`redirectAfterActionError` without an open wallet).
  A booking's notice offers "Rückgängig" for exactly that booking (`undoBooking`,
  root id), not "the last one" — another tab may have booked in between. A save
  failure caused by a reset elsewhere goes through `storage.notifyWalletReplaced`,
  never "Speicher voll". Booking limits (E5, `dbWalletActions.LIMITS`): at most 99
  drinks per booking (confirm from 20), credit at most 999, edits the same — refused,
  not clamped. The first "Teilen" on a device shows the bearer-link hint and shares
  only from its button (`localStorage` flag `db-wallet.share-hint-seen`).
- **Questions go to the shared dialog, not `confirm()`/`prompt()`** —
  `dbWalletHelpers.confirmDialog(text, {okLabel, danger, extra})` shows
  `#confirm-dialog` (on `wallet.html` and `index.html`) and resolves `true`/`false`
  (Escape = no; the focus goes back); without the dialog it falls back to
  `window.confirm`. `extra: {label, run}` shows `#confirm-extra` (only
  `index.html` has it) — a side action that keeps the question open; a string
  returned by `run()` becomes its new label (the start page's "Vorher Backup
  herunterladen"). `ctx.dialogConfirm` may
  answer a boolean or a Promise (`whenConfirmed`), so every action re-reads
  `ctx.getWallet()` after the answer — another tab may have changed it meanwhile:
  undo re-resolves its target and refuses if it moved, a row delete re-checks its
  entry, reset checks the open user. Credit comes from the inline `#credit-form`
  (`bookCredit(ctx, value)`, whole numbers only). History entries are edited and
  deleted from their row by **root id** (`editEntry(ctx, rootId, {date, amount})`,
  `deleteEntry(ctx, rootId)`) — no position numbers; the open edit form survives
  a re-render. An edit on the same day keeps the `ts`; another day keeps the time
  of day (today but later than now → now); a later day or a move across a pay is
  refused. Still native (synchronous boot/hash path): the `acg:` apply confirm in
  `wallet-ui.js`, the `ac:` target confirms in `wallet-import-v2.js`, and the v1
  migration prompt. The import choice (`import-preview.js` `chooseImportMode`) is
  its own native `<dialog>` (Escape/backdrop = cancel, the focus goes back).
- **CSP has no `'unsafe-inline'`** (index/wallet/preview) — no `style="…"`, no
  `<style>`, no `setAttribute("style")`/`.cssText`/HTML strings with `style=`; single
  `el.style.x = …` assignments are fine. Initially hidden elements get `display: none`
  from an `#id` rule in `style.css`, so their inline `style.display` starts as `""` —
  toggles must treat `""` as hidden (`tests/p3-3-csp.test.js` checks all of this).
  Newer UI toggles a class (`.is-visible`, `.is-expanded`) or the `hidden`
  attribute instead — `hidden` only works on elements whose CSS sets no `display`.
- **Card look = `.panel` / `.card` (P5.3)** — border, radius, shadow and background
  live only in `.panel, .card` in `style.css` (`.panel` on `--panel` for blocks on
  the page, `.card` on `--bg` for boxes inside one, `.card--flat` without the
  shadow). A new block or box gets the class (also from JS: `"wallet-card card
  card--flat"`); component rules set only size and spacing, and nothing switches
  the look off again (`tests/p5-3-css-panels.test.js`). Bare `section`/`pre` carry
  no look. JS keeps colors out of inline styles: the SW update notice goes to the
  status line (`sw-register.js`).
- **`wallet.html` layout (P4.2/P4.7/P4.9)** — `<header id="wallet-header">` (title,
  "Start"/"Info" links, user, device picker), then `<main>`: the fixed three-stat row
  (never hide a stat — the booking buttons must not jump), the booking block, then
  history, action codes, sync line, export, theme. One `h2` per block; headings that
  would only repeat what is visible use `.visually-hidden`. `#confirm-dialog` and
  `#status-line` stay direct `<body>` children, and so does the no-wallet notice
  (inserted after `#wallet-header`): the no-wallet CSS hides every other body child.
  The device picker is one labelled button ("Gerät: wählen") that expands to visible
  text + six `aria-pressed` symbols, no `title` tooltips. The sync line
  (`#sync-status-line`) shows only with a sync partner (`pickActivePeer`, i.e. after
  an import from another device); red adds a visible "Zum Export" button.
- **Start page (P4.5/P4.8)** — `index.html`: `<header id="index-header">`, then
  `<main>`: wallet list (`#existing-users-section`, hidden while empty; cards with
  "Öffnen" and a separate `.btn-danger` "Löschen"), "Wallet öffnen oder anlegen",
  "Link einfügen", import/raw (with "Alle löschen" in `.danger-zone`), theme.
  An existing name **opens** that wallet (never `makeUniqueUserId` here);
  `normalizeUserId` spells out ä/ö/ü/ß and strips other accents, everywhere
  (imports too). "Link einfügen" (`hashFromPastedLink` in `index-ui.js`) takes only
  the part after `#`/`%23` and hands import/`ac:`/`acg:` hashes to `wallet.html`;
  a bare name opens only an existing wallet (the data is not in it). Backups
  use `storage.walletBackupData` + `walletBackupFileName` + `helpers.downloadJson`
  — the same JSON as `wallet.html`'s export.
- **Load order is load-bearing** — every module is a `window.dbWalletX` IIFE that
  early-returns if a dependency namespace is missing; keep the `<script>` order in `wallet.html`.
- **Deploy allowlist** — Pages copies only the files on the `cp` line of
  `.github/workflows/pages.yml`. Every `APP_SHELL` entry, manifest icon and icon link
  must exist and be on that line, or `cache.addAll` fails and the SW never installs
  (`tests/p3-4-pwa.test.js`). The PNG icons are generated by `node scripts/make-icons.js`
  (`--check` verifies them); keep it in sync with `favicon.svg`.
- **Bump `service-worker.js` VERSION when any APP_SHELL asset changes** — enforced by
  `scripts/check-sw-version.sh` + the `sw-version` GitHub Action.
