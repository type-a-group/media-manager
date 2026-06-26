# Item 34 — Reimplement Masonry Grid Layout

> 1.0 brief. Backlog: [Item 34](../../FUTURE_CHANGES.md#34--reimplement-masonry-grid-layout). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready.** Coordinate with Item 8 — both touch `DataGrid`.

## Backlog snapshot

```yaml
status: ready
size: M
usefulness: 2
priority: low
files: [src/lib/components/data-grid/DataGrid.svelte, src/lib/components/data-grid/types.ts]
depends_on: []
open_questions: 0
acceptance:
  - Variable-height tiles packed without the dead space the fixed grid leaves
  - Wired into DataGrid behind the existing GridSize control (both files hub + record views inherit it)
  - Preserves the side-agnostic GridItem contract (incl. the reserved secondaryLabel)
```

## What & why

`@masonry-grid/svelte` is a kept-but-unused dependency. Visual polish only: pack variable-height tiles without the dead space the fixed grid leaves. Masonry applies to the **tile grid** (Files hub + record tile views) — **not** the records-native vertical list. The library-vs-CSS-columns-vs-small-JS-packer choice is an **implementation detail decided at build time**, not a product question — don't turn it into an open question.

## Decisions to resolve in the interview (Phase 1)

Mostly confirmations:

- Does masonry become the **default** layout, or an option behind a toggle alongside the existing `GridSize`? (Acceptance says wired behind GridSize — confirm default vs. opt-in.)
- Any constraints on tile aspect/clamping Nicholas wants (e.g. cap extreme aspect ratios so one tall image doesn't dominate)?
- Confirm it must stay side-agnostic (Files + Records inherit the same `GridItem` contract incl. `secondaryLabel`).

## Build notes (Phase 3)

- Wire into [`DataGrid.svelte`](../../../src/lib/components/data-grid/DataGrid.svelte) behind the existing `GridSize` control so both hosts inherit it for free.
- Preserve the `GridItem` contract in [`types.ts`](../../../src/lib/components/data-grid/types.ts) — no host-specific branching in the grid.
- Evaluate `@masonry-grid/svelte` vs. CSS `columns` vs. a tiny JS packer when you get there; if you drop the dependency, remove it from `package.json` in the same change (overlaps Item 35's hygiene goal).
- Watch performance with large grids (Item 8 raises the same concern) — virtualization may interact with packing; coordinate.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test:serve` — verify packing in the Files hub and a record tile view at multiple `GridSize` values; confirm no dead-space regression and tiles remain clickable/selectable.
- [ ] UI capture (screenshots at 2–3 grid sizes + a short video of resize) so Nicholas can judge the visual result — this feature is judged by eye.
- [ ] If the dependency choice changed `package.json`, confirm `npm run build` still succeeds.
- [ ] `FEATURES.md` updated (grid layout note); Item 34 → **Shipped & folded**; triage HTML synced.
