# Cleanup Plan (short)

## Findings
- Duplicate base64/safeParse/randomToken helpers in `action-codes.js` even though `wallet-helpers.js` is already loaded first.
- Redundant hash classification/parsing fallbacks in `index-ui.js` and `wallet-ui.js` despite `hash-router.js` being present on all pages.
- Small hot-path check in action-code UI uses `JSON.stringify` comparisons that can be made more explicit later if needed.

## Planned cleanup
- Use `dbWalletHelpers` in `action-codes.js` directly; remove local base64/safeParse/randomToken fallbacks.
- Route all hash classification/parsing through `hash-router.js` in `index-ui.js` / `wallet-ui.js`.
- Keep behavior identical; avoid schema/key/hash changes.

## Risk areas
- Hash routing: ensure `hash-router.js` is always loaded before callers.
- Action code encode/decode: ensure base64 output remains identical.

## Before/After Invariants (must stay true)
- Storage keys and wallet schema unchanged.
- Hash formats unchanged: `#<userId>`, `#import:`, `#i2:`, `#i2u:`, `#ac:`, `#acg:`.
- Tombstones (`t:"x"`) remain in event log and are ignored in totals.
- Action code SOFT/HARD limits (6/10) unchanged.
- Global `#acg:` selection/apply behavior unchanged.

## Completed (this pass)
- Removed duplicate base64/safeParse/randomToken helpers from `action-codes.js`; reuse `dbWalletHelpers`.
- Routed hash classification/parsing through `hash-router.js` only in `index-ui.js` and `wallet-ui.js`.
- Extended `self-check.js` to assert hash classifier results for local action and user routes.
