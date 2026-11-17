# TODO

Phase 0 to 5 of [`docs/improvement-plan.md`](docs/improvement-plan.md) are done
(phases 0 to 3 published 2026-11-10, phases 4 and 5 implemented 2026-11-17).

Still open: O1 in [`docs/open-points.md`](docs/open-points.md), the checks that need
a real phone (offline start, installed icon, share sheet, update notice of an
installed app). Update every device before syncing: since P5.5 an older app refuses
an export that contains deletions. What users see during the update is in README
§ Update; `node scripts/upgrade-check.js <published commit>` measures it before
a push to `main` (docs/upgrade-compat.md).
