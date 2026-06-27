# Item 13 — Swap Width / Height (orientation fix)

> 1.0 brief. Backlog: [Item 13](../../FUTURE_CHANGES.md#shipped--folded). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ✅ shipped** — reframed into a dimension-consistency check + fix; design plan: [`13-swap-dimensions-plan.html`](13-swap-dimensions-plan.html).
>
> **Reframe (interview):** not a free-floating swap button — it surfaces **only when stored dims disagree with the real (orientation-corrected) image**, in the **Metadata popup** (warning badge + banner), with a smart **"Correct dimensions"** and a manual **"Swap W↔H"** escape hatch. EXIF-orientation is the root cause; detection is dependency-free (exiftool). Pixel re-encode / orientation-baking deferred (Item 35/`sharp`).

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

- [x] `npm run check` + `npm run lint` clean (touched files).
- [x] `npm run test` — orientation helpers (1–8), `compareStoredVsImage`, `setBlobDimensions` (108 pass).
- [x] `npm run test:serve` — endpoint matrix: mismatch detected, correct/swap persist + clear, 400/404 guards.
- [x] UI capture of the swap action (before → after dims).
- [x] `FEATURES.md` updated; Item 13 → **Shipped & folded**; triage HTML synced.

## ✅ Shipped — manual smoke test (developer)

Run `npm run test:serve` (throwaway fixture — never a real root). The fixture now ships
`rotated.jpg` (EXIF Orientation 6, stored dims **1200×800** but the image displays **800×1200**).

1. **Badge:** `/files` → click **rotated.jpg** (it's unclassified, shows portrait). The side
   panel's **ⓘ Metadata** button carries an **amber "!" dot**; hover → "Stored dimensions look wrong".
   The three PNGs / the `.txt` show **no** badge.
2. **Banner + correct:** open the metadata popup → amber banner _"Stored dimensions don't match the
   image — Stored 1200 × 800, … corrected 800 × 1200 · EXIF Orientation 6."_ Click **Correct
   dimensions → 800 × 1200** → toast, **banner + badge disappear**. (The "Image Properties" Width/Height
   still read the file's raw EXIF 1200×800 — expected; we corrected the manifest's _displayed_ dims,
   not the pixels.)
3. **Persists:** reload the page → no badge on rotated.jpg (the manifest now stores 800×1200).
4. **Swap escape hatch:** to see it again, the manual **Swap W↔H** transposes whatever is stored — use
   it when the smart guess is wrong. (Both buttons live in the same on-mismatch banner.)
5. **Not an image:** the `.txt` / a PDF never run the check — no badge, no banner.
