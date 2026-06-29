# Item 9 — Sorting & Ordering

> 1.0 brief. Backlog: [Item 9](../../FUTURE_CHANGES.md#9--sorting--ordering). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready** (no open questions) — interview can be short.

## Backlog snapshot

```yaml
status: ready
size: M
usefulness: 4
priority: medium
files: [src/lib/storage/classRepo.ts, src/lib/storage/jsonRepo.ts, src/lib/stores/settings.ts]
depends_on: []
open_questions: 0
acceptance:
  - A sort control (field + direction) in the grid/rail headers
  - Built-in sorts: by last_modified/created, by name, by any schema field
  - Applied in the list endpoints (records list / class members / files), choice persisted per-type and/or session
```

## What & why

A basic, expected, daily-use control that's still missing. Lists currently come back in an implicit order; users want to sort by name, recency, or any schema field, ascending/descending. Sorting belongs in the **server read layer** (`classRepo.ts` / `jsonRepo.ts` — the old `repo.ts` is gone) so it composes with the existing server-side search/filter rather than re-sorting on the client.

## Decisions to resolve in the interview (Phase 1)

Item is `ready`, so these are confirmations, not blockers:

- Persist sort **per-type** (durable default), **per-session**, or both? (Backlog allows either — confirm Nicholas's preference; mirrors how grid size / group-by persist today.)
- Does the sort control live in the **rail header**, the **content toolbar**, or both? (Match where group-by/size already sit.)
- Default sort when none chosen (last_modified desc is the natural default).

## Build notes (Phase 3)

- Extend the list endpoints with `?sort=<field>&dir=<asc|desc>` — records `list`, `/api/classes/[id]/members`, and `/api/files`. Apply in `jsonRepo.listRecords` / `classRepo.listAllFiles` / `listClassMembers`, alongside the existing search/filter so they compose.
- Sortable fields: `name` (filename / title), `last_modified`, created (if available), and any user schema field via `schemaUserFields()`.
- UI: a shadcn `Select` (or `DropdownMenu`) for field + a direction toggle, matching the existing toolbar controls. Persist via `stores/settings.ts` (same place grid size lives).
- Mirror across all three sub-apps (Files / Records / catalog views) so behaviour is uniform.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — unit coverage for the sort logic in `jsonRepo`/`classRepo` (each built-in sort + asc/desc + stable tie-break).
- [ ] `npm run test:serve` — sort by name / recency / a schema field in Files, Records, and a single-class catalog view; confirm it composes with an active search + filter.
- [ ] UI capture (`test-ui-feature`) of the sort control + before/after ordering.
- [ ] Persistence verified across reload (per the decided policy).
- [ ] `FEATURES.md` updated (new query params on the list endpoints); Item 9 → **Shipped & folded**; triage HTML synced.

## ✅ Shipped — manual smoke test (developer)

Run `npm run test:serve` (throwaway fixture — never a real root) and confirm:

1. **Records** (`/media` → Notes): toolbar shows **Sort [Last modified ↓]**; switch to **Name** → A→Z, toggle **↑/↓** reverses; sort by **Priority** → empty-value rows sink to the bottom in *both* directions; type in search → results stay sorted.
2. **Persistence:** pick a sort, **reload** → it sticks; a second record type keeps its **own** sort.
3. **Files — All Files** (`/files`): **Sort [Date added ↓]** → switch to Name/Size + toggle; reload → hub sort persists.
4. **Files — catalog** (tick one class): sort options also include **Last modified** + the class's schema fields; reload in that class → persists **per class**; untick → All Files shows the **hub** sort (independent).
5. **Timestamp:** open a file → header **"Added <date>"**, each class section **"Modified <date>"**; open a record / Globals (after an edit) → **"Modified <date>"**; confirm it is **not** on the grid tiles.
