# Cleanup Report (after refactor)

Scope: file-level audit only (no code removal).

## Summary

- No clearly unused files found: every `.js`/`.css` is referenced by at least one `.html` file in this repo.
- Optional-only pages exist (palette preview), but they are still linked from UI.
- Hash parsing is centralized via `hash-router.js`.
- Summary computation now has normalization + safe path (`computeSummarySafe`) shared with preview.
- Action codes use inline UI controls (no popup dialogs).
- Action-code amount prompt is type-aware (trinken vs gutschreiben).
- History diagram now includes the daily drink count in brackets.
- Undo/deletes now emit tombstone entries (ts/id order) so removals sync across devices.
- Unpaid/credit stats are hidden when zero.
- Action code QR payloads are slimmer (backward compatible decode).
- `self-check.js` covers storage roundtrip, import v2 decode, migration, hash parsing, summary parity, tombstones/undo, and action code edits.

## Completed Work

- Introduced `hash-router.js` to keep hash parsing in one place and reduce duplication.
- Added summary normalization and safe computation (`computeSummarySafe`) with fallback logging.
- Replaced action-code popup flows with inline create/edit/delete UI.
- Made action-code amount prompts type-specific in the inline form.
- Enhanced history diagram output with `[drinkCount]` per day.
- Tombstone deletes: undo/delete adds deletion markers and recomputes from effective events.
- Added v2 import/export extension for tombstone events.
- Hide unpaid/credit stats when the values are zero.
- Removed the “Neu erzeugen” action-code button (editing refreshes payloads).
- Slimmed action-code QR payloads with backward-compatible decode.
- Expanded `self-check.js` coverage for summaries, tombstones/undo, and action code behavior.

## DeviceId/seq Review (not safe to merge)

- `wallet.deviceId` is a stable string exported in JSON and used by the v2 import
  sync-peer extension (`sp`) for peer labeling when no `seq` exists.
- `wallet.seq` is an object keyed by local `deviceKey` and drives compact event IDs.
- They have different shapes and responsibilities; merging would change schema,
  break imports/exports, and risk event-id collisions.
- Smallest safe path if desired later: keep both fields, introduce a derived alias
  (e.g. `deviceKeyShort`) behind a migration, and accept legacy wallets unchanged.

## Remaining TODOs

- Add an optional UI entry point for running `dbWalletSelfCheck.run()` without opening the console.
- Add a small visual hint when an action code is in edit/delete-confirm mode.
- Consider a soft-limit helper note that can be dismissed per session.

## File Usage Matrix

| File | Status | Referenced by | Notes / Recommendation |
|---|---|---|---|
| `index.html` | active | — | App entry point (start page). |
| `wallet.html` | active | — | Main wallet UI. |
| `preview.html` | active | `import-preview.js` | Read-only import preview target. |
| `colors.html` | active (optional) | linked from `index.html`, `wallet.html` | Palette preview; remove only if you also remove the link (breaking UX). |
| `style.css` | active | `index.html`, `wallet.html`, `preview.html` | Core styling. |
| `themes.css` | active | `index.html`, `wallet.html`, `preview.html`, `colors.html` | Theme tokens/styles. |
| `colors.css` | active (optional) | `colors.html` | Only used by palette preview page. |
| `theme.js` | active | `index.html`, `wallet.html`, `preview.html` | Theme selector + persistence. |
| `import-preview.js` | active | `index.html`, `wallet.html`, `preview.html` | Import mode chooser + preview flow. |
| `qrcodegen.js` | active | `wallet.html` | QR rendering for exports. |
| `migration.js` | active (optional) | `wallet.html` | V1→V2 migration helpers. |
| `action-codes.js` | active | `wallet.html`, `index.html` | Action codes UI + merge helpers used during import. |
| `hash-router.js` | active | `wallet.html`, `index.html` | Hash parsing helpers (ac/import/i2/i2u). |
| `self-check.js` | active | `wallet.html`, `index.html` | In-browser self-check diagnostics (console). |
| `wallet-helpers.js` | active | `wallet.html`, `index.html` | Shared helpers (storage wrappers, base64, gzip). |
| `wallet-storage.js` | active | `wallet.html`, `index.html` | Storage + wallet model functions (device keys, load/save). |
| `wallet-import-v2.js` | active | `wallet.html`, `index.html` | Import/export v2 codec + hash import routing. |
| `wallet-summary.js` | active | `wallet.html`, `index.html` | Pure summary computation. |
| `wallet-sync.js` | active | `wallet.html` | Local-only sync status helpers. |
| `wallet-history-ui.js` | active | `wallet.html` | History UI (diagram/log/raw). |
| `wallet-ui.js` | active | `wallet.html` | Wallet DOM wiring + interactions. |
| `index-ui.js` | active | `index.html` | Start page UI wiring + import/redirect. |
| `README.md` | active | — | Documentation. |
| `LICENSE` | active | — | License file. |
