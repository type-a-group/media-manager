# Unify Files & Records — implementation plan

Companion to `docs/unify-files-records-plan.html`. Goal: converge the Files hub
(`/files`) and Records page (`/media`) onto shared primitives, apply the requested UI
changes, and delete forked code.

## Locked decisions

- **Header stays in the content column** (panel opens beside it). "Full-width" is achieved
  by Records no longer reserving panel space.
- **Maximize reuse**: Records' detail pane → `EditorPanelShell`; Records' list → `DataGrid`
  (text variant + subtitle); shared `SearchBox` + `SearchFieldSelect` + `schemaUserFields()`.
- **One autosave policy**: both panels use Records' debounced-always autosave. `FileEditorPanel`
  drops its explicit per-section "Save" buttons and gains the debounced save + status indicator.
- **Grid subtitle**: add optional `GridItem.secondaryLabel` now (Records text list uses it);
  wiring a subtitle onto Files thumbnail tiles is deferred.
- **Files header ⋮** stays solo-class-only (already correct).
- **Search-field picker** defaults to **All fields**, narrowable to one field. Trigger text
  truncates so it can't clip out.
- **Search scope is server-side** (the list payloads carry no per-field values). Field-scoped
  search is added to `jsonRepo.listRecords` (Records), `listClassMembers` (solo class), and
  `listAllFiles` (All Files filename + intersection `classId::field`), reusing
  `stringifyFieldValue`. Decision: **full coverage incl. intersection**.

---

## Phase 0 — Shared field-enumeration util (foundation)

**Why first:** five near-identical "list a schema's fields" copies; the search-field picker
needs one canonical source.

1. Add to `src/lib/core/fieldKeys.ts`:
   ```ts
   export function schemaUserFields(schema): { key: string; label: string }[];
   ```
   Filters `isUserFieldKey(k) || k === 'name'`, sorts name-first then alpha, maps to
   `{ key, label: fieldLabel(key) }` (move/`import` `fieldLabel`).
2. Add a unit test `src/lib/core/fieldKeys.test.ts` (name-first ordering, system-key exclusion).
3. Replace copies:
   - `RecordListColumn.svelte` `schemaFieldKeys`
   - `RecordDetailPane.svelte` `getOrderedEditableKeys`
   - `RecordFilterPanel.svelte` `schemaFields`
   - `entity-settings/adapters.ts` `typeFields()` / `classFields()`

**Verify:** `npm run check`, `npm run test`.

---

## Phase 1 — Shared `SearchBox` + `SearchFieldSelect`

1. `src/lib/components/SearchBox.svelte` — `bind:value` query `Input` (placeholder prop),
   composing the shadcn `Input`. Replaces the two inline inputs.
2. `src/lib/components/SearchFieldSelect.svelte` — a `Select` under the search box.
   - Props: `fields: {key,label}[]`, `bind:value` (`'' = All fields`), `disabled`.
   - First item `All fields` (value `''`), then one item per field.
   - Trigger label wrapped with `truncate`/`max-w` so a long field name can't clip out
     (the "doesn't clip out of it" requirement). Verify `Select.Content` width too.
3. Wire into **Files** rail `belowHeader`: field list = `schemaUserFields` of the solo class,
   or the intersection of selected classes (mirror `crossOptions` logic), else just
   `Filename`. Default `All fields`.
4. Wire into **Records** rail (Phase 2 moves the search there).

**Verify:** `npm run check`.

---

## Phase 2 — Records rail: search in rail + inline "+ New type"

Files touched: `src/lib/components/records/RecordsRail.svelte`, `src/routes/media/+page.svelte`.

1. Pass `query`/`searchField` + the active type's `fields` into `RecordsRail`; render
   `SearchBox` + `SearchFieldSelect` in the rail's `belowHeader` slot (lift `query` state
   binding from `RecordListColumn` up to the page, hand to the rail).
2. Replace the bottom full-width "New record type" button with a section label
   **`Record types`** + inline **`+ New`** button (mirror Files `Classes · + New`). Keep the
   collapsed-rail icon affordance.
3. Remove the search `Input` from `RecordListColumn` header (now in the rail).

**Verify:** `npm run check`; manual: search filters list from the rail.

---

## Phase 3 — Records search becomes field-scoped

In `src/routes/media/+page.svelte` filtering (currently client-side over `recordListTitle`):

1. Compute the match against `searchField`:
   - `'' (All fields)` → match if query is a substring of any stringified user-field value
     (reuse `stringifyFieldValue` semantics or the list item's field values).
   - specific field → match only that field's stringified value.
2. Keep title fallback so empty-field rows still searchable under All fields.

**Verify:** `npm run test` (add a small filter unit test if logic is extracted to a helper).

---

## Phase 4 — Records list (kept records-native) + optional grid subtitle

**Decision change:** do **not** convert the Records list to `DataGrid` tiles. The vertical
title+subtitle list is records-native (per the records-as-subapp preference + the reviewed
mockup), and none of the requested changes ask for tiles. Forcing tiles would degrade the
deliberately-chosen list UX. Dedup is achieved via the shared `SearchBox`/`SearchFieldSelect`,
the field util, the rail, and `EditorPanelShell` (Phase 5) instead.

1. `RecordListColumn.svelte`: remove its in-header search `Input`, the `query` prop, and the
   client-side title filter (search is server-side via the rail now). Keep the header (count ·
   group · filter · ⋮ · + New), the bulk bar, and the vertical list.
2. Verify title + subtitle still `truncate` (ellipsis) against long real strings.
3. Still honor the "optional grid subtitle" ask: add optional `GridItem.secondaryLabel` to
   `data-grid/types.ts` and render it (muted, truncated) in `DataGrid.svelte` when present, so
   **Files tiles** can show a subtitle later. Wiring it onto Files tiles is deferred.

**Verify:** `npm run check`; manual screenshots (grouped + flat, long title/subtitle ellipsis).

---

## Phase 5 — Records detail pane → `EditorPanelShell`

1. Refactor `RecordDetailPane.svelte` to wrap `EditorPanelShell` (prev/next chevrons → its
   ←/→ keys + chevrons, close, title snippet, actions snippet for Delete + save-status).
2. Keep Records' **debounced autosave**; wire `advance`/close to flush pending saves.
3. In `src/routes/media/+page.svelte`, **delete the 440px placeholder `<aside>`**; render
   `<RecordDetailPane>` only `{#if selectedRecordId}` (matches Files). The content header now
   spans full width when nothing is open.

**Verify:** `npm run check`, `npm run test`; manual: open/close, prev/next, autosave status,
arrow-key nav skips while typing.

## Phase 5b — Files panel: adopt debounced autosave

Bring `FileEditorPanel.svelte` onto the same save policy as Records.

1. Replace the explicit per-section "Save {ClassName}" buttons + Enter-to-save with a
   **debounced autosave** (reuse the 600ms debounce + flush-on-advance/close/unload pattern
   from `RecordDetailPane`).
2. Add the "Saving…/Saved/Save failed" status into the `EditorPanelShell` header actions slot.
3. Keep per-section dirty detection (snapshot compare) but trigger saves on field change, not a
   button. Confirm `onchanged` still refreshes the grid (class chips, missing-file warnings).

**Verify:** `npm run check`; manual: edit a field, see it autosave; advance/close flush;
no stranded "Save" buttons.

---

## Phase 6 — Files parity polish

1. Confirm Files header ⋮ (solo-class) matches Records' header ⋮ styling (`triggerClass`).
2. Files rail: ensure `SearchFieldSelect` sits directly under `SearchBox`; field list reflects
   solo/intersection/else-filename.
3. Optional (low-risk): extract `FilesRail.svelte` from the inline rail snippets for symmetry
   with `RecordsRail.svelte`. **Defer if it balloons scope** — note in FUTURE_CHANGES instead.

**Verify:** `npm run check`.

---

## Phase 7 — Docs, tests, end-to-end

1. Update `docs/FEATURES.md`: Records search-in-rail, search-field picker (both sides),
   Records list now `DataGrid`, detail pane on `EditorPanelShell`, panel-hidden-until-click.
2. Update `CLAUDE.md` Frontend section where it describes `RecordListColumn`/`RecordDetailPane`
   composition (now shared with Files via `DataGrid`/`EditorPanelShell`).
3. If on-disk structure is unchanged (it is — no settings/schema changes), **no fixture edit
   needed**. (Search field is ephemeral UI state, not persisted.)
4. `npm run check` (0/0), `npm run test`, `npm run lint`, `npm run build`.
5. Playwright via `npm run test:serve` + `scripts/ui-capture.mjs`: capture Files & Records
   (rail search + field-picker, grid, open panel, long-title ellipsis, grouped view); assert
   no console errors.

---

## Risk register

| Risk                                      | Mitigation                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Autosave regression merging panels        | Keep host save policy; shell = chrome only; test status indicator + flush-on-advance |
| DataGrid text variant breaks Files tiles  | `secondaryLabel` optional; Files omits it; visual diff both sides                    |
| Field-picker trigger clipping long labels | `truncate` + `max-w` on trigger; verify in Playwright                                |
| Intersection field list (Files) wrong     | Reuse existing `crossOptions`/`catalogSchemaKeys` logic, don't reinvent              |
| Scope creep on `FilesRail` extraction     | Phase 6 marks it optional/deferrable                                                 |

## Out of scope

Globals editor, server-side search params, mobile drill-down, deep-link routing, icon picker.
