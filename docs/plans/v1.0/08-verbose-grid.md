# Item 8 — Configurable & Verbose Grid Display

> ✅ **Shipped 2026-06-28.** The **"Show"** control lives in the shared `VerboseFieldsMenu` (`Show ▾` popover: **Show on tiles** master toggle + **grouped** scrollable 6-item-capped checkboxes with divider headers) rendering chosen items as key/value rows under each tile/row on **both** Files (`DataGrid` masonry card) and Records (`RecordListColumn`). Items come in two groups: **File info** (blob-intrinsic — size/dimensions/type/date-added — namespaced `file:*`, resolved client-side, available in **every** Files view incl. a single-class catalog) and **Fields** (class/type schema, server-resolved inline as `field_values` via `?fields=`, shared `buildFieldValues` in `core/recordDisplay.ts` — no per-tile fetch). A catalog can mix both on one tile; All Files shows File info only; Records shows its type's fields. Persisted durable per-entity (class `config` · type `settings.json` · `media/settings.json`). Approved plan: [`08-verbose-grid-plan.html`](08-verbose-grid-plan.html) — note the shipped UI refined the plan's single-list "Fields" popover into the grouped **"Show"** control (renamed for clarity + File info surfaced in the catalog). Virtualization for large catalogs was carved out → [Item 40](../../FUTURE_CHANGES.md#40--grid-virtualization-for-large-catalogs). The original brief follows for history.
>
> 1.0 brief. Backlog: [Item 8](../../FUTURE_CHANGES.md#shipped--folded). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). High priority, user-requested (Lightroom-style scanning).

## Backlog snapshot

```yaml
status: blocked
size: L
usefulness: 5
priority: high
files: [src/lib/components/data-grid/DataGrid.svelte, src/lib/components/data-grid/types.ts, src/lib/stores/settings.ts, src/lib/storage/jsonRepo.ts, src/lib/storage/classRepo.ts]
depends_on: []
open_questions: 3
acceptance:
  - A field-subset picker drives a "verbose" multi-field card (key/value rows or chips) per tile
  - Image grids show metadata fields next to a larger thumbnail
  - List responses carry the requested field values per item (extend list endpoints, don't fetch per-record)
  - Choice persists (per-session and/or durable per-type default)
```

> 🔧 **Already partly shipped.** The single tile grid is [`DataGrid.svelte`](../../../src/lib/components/data-grid/DataGrid.svelte) (+ `types.ts`); grid state lives in [`stores/settings.ts`](../../../src/lib/stores/settings.ts); the **display-field / title-by selector already shipped** (per-entity `displayField` in `EntitySettingsDialog`). What remains is the **verbose multi-field mode** + the **field-subset picker**.

## What & why

Highest-usefulness item in 1.0 (5/5). Today a tile shows a thumbnail + one title. Users scanning a catalog want to see **several metadata fields at once** (a Lightroom-style verbose card) and choose **which** fields show. The data half matters: list endpoints must return the requested field values **per item** so we don't fan out a request per tile.

## Open questions to resolve in the interview (Phase 1) — REQUIRED before building

This item is `blocked` until all three are closed; closing them is the deliverable of Phase 1/2.

1. **Persistence:** per-type **durable default** vs. **per-session** vs. both? (Group-by/size precedent leans durable-per-type.)
2. **Verbose layout:** key/value rows vs. a mini-table vs. chips? Get a concrete mock — this is the central "what should it look like" decision. Likely differs for image tiles (fields *beside* a larger thumbnail) vs. text tiles (fields stacked).
3. **Scale / performance:** how many fields before lists get noisy or slow — a hard cap, virtualization, or both? Decide the ceiling now so the list-endpoint shape is right the first time.

Also confirm: does verbose mode apply to **both** the Files hub and the Records tile views (shared `DataGrid`), and how it interacts with the existing `displayField`/group-by/size controls.

## Build notes (Phase 3)

- Extend the list endpoints (`jsonRepo.listRecords`, `classRepo.listAllFiles`/`listClassMembers`) to accept a **requested field set** and return those values inline on each row — this is the load-bearing change; design it once for both sides.
- Add a **field-subset picker** (from `schemaUserFields()`) and a verbose/compact toggle to the grid toolbar; persist per the decided policy in `stores/settings.ts`.
- Render the verbose card inside `DataGrid` via the side-agnostic `GridItem` contract — extend `types.ts` for the multi-field payload; no host-specific branching.
- Coordinate with **Item 34 (masonry)** — verbose cards are variable-height, which is exactly what masonry packs. Sequence/merge intentionally.

## Verification stages (Phase 4)

- [ ] HTML plan approved with the three open questions resolved + layout mock.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — list endpoints return the requested field values inline (correct values, respects the field cap, no per-record fan-out).
- [ ] `npm run test:serve` — pick a field subset, toggle verbose; confirm it works in Files + Records, composes with sort/filter/group-by, and persists per policy. Test at the field-count ceiling for noise/perf.
- [ ] UI capture of compact vs. verbose at a couple of grid sizes (image tiles + text tiles).
- [ ] `FEATURES.md` updated (new list-endpoint params + grid mode); Item 8 → **Shipped & folded**; triage HTML synced.
