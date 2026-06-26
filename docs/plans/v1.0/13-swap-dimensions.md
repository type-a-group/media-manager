# Item 13 — Swap Width / Height (orientation fix)

> 1.0 brief. Backlog: [Item 13](../../FUTURE_CHANGES.md#13--swap-widthheight-orientation-fix). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready.**

## Backlog snapshot

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/lib/components/FileEditorPanel.svelte, src/lib/storage/classRepo.ts]
depends_on: []
open_questions: 0
acceptance:
  - A per-record action to swap the stored width and height values
  - Optionally a heuristic warning when stored dims look inconsistent with the decoded image, offering the swap
```

## What & why

Stored `width`/`height` (written on upload) can end up **transposed** for some EXIF-oriented images. Niche but real. The **manual swap action** needs no new dependency and is fully `ready`. The optional **heuristic warning** half (detect that stored dims disagree with the decoded image and offer the swap) would lean on `sharp` — see Item 35; keep it out of the `ready` core unless the 35 decision lands first.

## Decisions to resolve in the interview (Phase 1)

- Ship **manual swap only** for 1.0 (clean, no new dep), or pull in the heuristic warning (couples to the Item 35 `sharp` decision)? Recommend manual-only for 1.0.
- Where the action lives in `FileEditorPanel` (near the dimensions display / metadata section).
- Does the swap apply to the blob's intrinsic dims (manifest) or a class record's width/height field? Confirm which `width`/`height` is being corrected.

## Build notes (Phase 3)

- A small per-file action that writes the swapped values via the existing persistence path in `classRepo.ts`; no new endpoint shape if it fits the metadata update path.
- If the heuristic is deferred, leave a clear seam (a TODO + the Item 35 reference) rather than half-building it.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — swap writes the transposed values and nothing else changes.
- [ ] `npm run test:serve` — swap a fixture file's dims, confirm persistence + that the grid/editor reflect the corrected orientation.
- [ ] UI capture of the swap action (before → after dims).
- [ ] `FEATURES.md` updated; Item 13 → **Shipped & folded**; triage HTML synced.
