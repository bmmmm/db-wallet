# Cleanup Report (after refactor)

Scope: file-level audit only (no code removal).

## Summary

- No clearly unused files found: every `.js`/`.css` is referenced by at least one `.html` file in this repo.
- Optional-only pages exist (palette preview), but they are still linked from UI.

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
| `wallet-helpers.js` | active | `wallet.html`, `index.html` | Shared helpers (storage wrappers, base64, gzip). |
| `wallet-storage.js` | active | `wallet.html`, `index.html` | Storage + wallet model functions (device keys, load/save). |
| `wallet-import-v2.js` | active | `wallet.html`, `index.html` | Import/export v2 codec + hash import routing. |
| `wallet-summary.js` | active | `wallet.html`, `index.html` | Pure summary computation. |
| `wallet-sync.js` | active | `wallet.html` | Local-only sync status helpers. |
| `wallet-ui.js` | active | `wallet.html` | Wallet DOM wiring + interactions. |
| `index-ui.js` | active | `index.html` | Start page UI wiring + import/redirect. |
| `README.md` | active | — | Documentation. |
| `LICENSE` | active | — | License file. |

