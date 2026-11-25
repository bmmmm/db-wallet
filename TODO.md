# TODO

Phase 0 to 5 of [`docs/improvement-plan.md`](docs/improvement-plan.md) are done
(phases 0 to 3 published 2026-11-10, phases 4 and 5 implemented 2026-11-17), and
so is the cleanup release of 2026-11-25 (`5e81555`, CHANGELOG).

Still open: O1 in [`docs/open-points.md`](docs/open-points.md), the checks that need
a real phone (offline start, installed icon, share sheet, update notice of an
installed app). Update every device before syncing: since P5.5 an older app refuses
an export that contains deletions. What users see during the update is in README
§ Update; `node scripts/upgrade-check.js <published commit>` measures it before
a push to `main` (docs/upgrade-compat.md).

## With the next release

Not urgent, and not worth a release of its own: each one shows every device the
update notice and a mixed first start. Do these when the next real change ships,
and run `node scripts/upgrade-check.js 5e81555` before the push.

- Remove the hidden `#raw-scope-placeholder` (with `#raw-scope-current` /
  `#raw-scope-all`) from `wallet.html` and its expectation in
  `tests/wallet-ui-cleanup.test.js`. Only the `wallet-ui.js` of 2026-11-17 and
  older needs those ids (docs/upgrade-compat.md S6-boot); a device that jumps from
  that release straight to the next one then boots its first start without the
  wallet UI until it taps "Aktualisieren".
- Drop the version label of the import preview: `#wallet-version` ("v2") in
  `preview.html`, its two lines in `import-preview.js` (both null-checked, so an
  old cached script copes) and `v` in the summary if nothing else reads it.
  `wallet.html` lost the same label with the silent v1 migration.
