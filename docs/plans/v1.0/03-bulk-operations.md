# Item 3 — Bulk Operations (bulk-export remainder)

> 1.0 brief. Backlog: [Item 3](../../FUTURE_CHANGES.md#3--bulk-operations--bulk-export-remainder). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready — mostly shipped.**

## Backlog snapshot

```yaml
status: ready
size: S
usefulness: 1
priority: low
files: [src/lib/components/RecordBulkActions.svelte, src/routes/api/media-types/[typeId]/records/bulk-update, src/routes/api/media-types/[typeId]/records/bulk-delete]
depends_on: []
open_questions: 0
acceptance:
  - Bulk-export selected records as JSON (the only remaining bulk action)
```

## What & why

Bulk-**update** a field and bulk-**delete** across a selection both already exist ([`RecordBulkActions.svelte`](../../../src/lib/components/RecordBulkActions.svelte) + the `bulk-update`/`bulk-delete` endpoints). The **only** remaining bulk action is **export selected records as JSON**. Small; mostly a wiring + download task. Low usefulness — include it to *close the item*, not to gold-plate it.

## Decisions to resolve in the interview (Phase 1)

- Export shape: array of full record DTOs (snake_case on-disk form) vs. a flattened display form — default to the on-disk DTO so it round-trips and pairs with Item 4 (schema import/export) later.
- Client-side download of the current selection vs. a server endpoint — given the selection is already in memory, a client-side `Blob` download may suffice; confirm.
- Does this also apply to the Files side (export selected files' metadata) for 1.0, or Records-only? (Acceptance is Records-only.)

## Build notes (Phase 3)

- Add an "Export JSON" action to `RecordBulkActions.svelte` next to Set field… / Delete.
- Prefer reusing the records already loaded for the selection; only add a server endpoint if the selection can exceed what's in memory.
- Filename: `<typeId>-records-<timestamp>.json`.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — if a server endpoint is added, unit-test the serialization; otherwise assert the export builder produces valid round-trippable JSON.
- [ ] `npm run test:serve` — select several records, export, confirm the downloaded JSON matches on-disk records and re-imports cleanly (smoke).
- [ ] UI capture of the bulk bar with the new action.
- [ ] `FEATURES.md` updated if an endpoint is added; Item 3 → **Shipped & folded**; triage HTML synced.
