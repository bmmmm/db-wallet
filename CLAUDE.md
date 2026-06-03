# db-wallet

Browser-only Getränke-Wallet — kein Backend, kein Server, alles lokal im Browser.
PWA (Progressive Web App) für Getränke-Tracking und -Verwaltung.

## Identity

Commits use the repo's configured git identity (GitHub user `bmmmm`). `origin` is the
public GitHub repo — push with `git push origin main`.

**Planned:** move the source of truth to a self-hosted Forgejo with a one-way push-mirror
to GitHub. Until then, GitHub is the only remote. Real hosts/tokens live in `~/.env` /
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
SW + clear caches, or serve on a fresh port.

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
| `wallet-helpers.js` | Shared Helpers (base64url, gzip, IDs, Hashing) |
| `migration.js` | Datenmigration v1→v2 |
| `hash-router.js` | Client-seitiges Routing via URL-Hash |
| `self-check.js` | In-Browser-Testsuite (`dbWalletSelfCheck.run()`) |
| `manifest.json` | PWA Manifest |
| `themes.css` / `colors.css` | Theme-System |

## Gotchas

- **Event model is append-only** — drink/credit/pay append a new event; delete/undo/edit
  append a tombstone (`t:"x"`, `ref` = target id). Never mutate an event in place: the
  import/sync merge dedups strictly by `id`, so an in-place edit silently fails to
  propagate. Order: sort by `ts`, tie-break by numeric base36 seq (not lexical).
- **Load order is load-bearing** — every module is a `window.dbWalletX` IIFE that
  early-returns if a dependency namespace is missing; keep the `<script>` order in `wallet.html`.
