# Records Explorer — implementation plan

Status: **shipped.** Implemented on the `global-files` branch — `/media` is now the three-pane Records
Explorer (`media/+page.svelte` + `RecordsRail`/`RecordListColumn`/`RecordDetailPane`), `/media/[typeId]`
307-redirects in, autosave replaces the Save button, the id-instead-of-title bug is fixed via
`recordDisplay.ts` + the `?titleField=` list param, and `railCollapsed` persists. `FEATURES.md` updated;
`RecordEditorPanel.svelte` removed (superseded). Companion visual mockups live in
[`records-ui-plan.html`](records-ui-plan.html). The section below is kept as the design record.

## 1. Goal & framing

Records (`/media`, standalone schema-backed `json` types) are a **separate-but-related sub-app** from Files
(`/files`, blobs + classes). The redesign does **not** clone the Files hub. Instead it gives records a dedicated
**three-pane Explorer**:

```
┌────────────┬───────────────────────┬───────────────────────────┐
│ TYPE RAIL  │ RECORD LIST           │ DETAIL (inline editor)    │
│ (collapsible)│ search·group·filter·sort│ FieldInput stack, autosave│
│ Notes  •   │ ▸ Welcome note        │ Title  [Welcome note]     │
│ Contacts   │   Roadmap Q3          │ Priority [High ▾]         │
│ Books      │   Grocery list        │ Body   [ … ]              │
│ + New type │                       │                           │
└────────────┴───────────────────────┴───────────────────────────┘
```

The **rail is the cross-cutting navigator** (the thing we liked from the Files class sidebar), but it is
**records-only** and **switches the active type** — there is deliberately **no "All Records" merged view**
(records aren't attached to blobs the way files are; a record type is the records-side analogue of a class).

### Locked decisions

1. **Rail content:** pure record types only. A Home button (⌂) returns to the dashboard; Settings (⚙) pinned in the rail footer. No "Files" entry.
2. **Type icons:** generic glyph for now (no per-type icon). A per-type/per-class **icon picker is deferred** → backlog Item 28.
3. **Save model:** **autosave** in the detail pane (debounced on change + flush on blur/navigation/close), with a "✓ saved" / "Saving…" indicator. Drop the explicit Save button. Keep explicit Delete.
4. **Routing:** keep **in-page selection** of type + record (no per-record URL yet). Deep-link routing (`/media/[typeId]/[recordId]`) is **deferred** → backlog Item 20.
5. **Mobile:** desktop three-pane only for now. Narrow-width drill-down (rail → list → detail) is **deferred** → backlog Item 29.
6. **Scope:** Files hub (`/files`) is **untouched**. `globals` keeps its bespoke editor (backlog Item 25) and is reached through the rail like any type but renders `GlobalsEditorPane` in the detail area instead of the list+detail split.

## 2. Current state (what exists today)

- **Route:** only `src/routes/media/[typeId]/+page.svelte`. It is a self-contained page: `Sidebar` (search + `RecordFilterPanel`) + shared `DataGrid` (text-variant tiles) + a floating `RecordEditorPanel`. The reserved `globals` id short-circuits to a bare header + `GlobalsEditorPane`. Reached only via dashboard cards (`/` → `/media/<id>`); there is **no `/media` index route**.
- **Components (reuse these):**
  - `RecordEditorPanel.svelte` (276 lines) — schema → `FieldInput` stack, explicit Save + autosave-on-advance, Delete, wrapped in `EditorPanelShell`.
  - `RecordFilterPanel.svelte` (241) — multi-row field/operator/value filter UI; `bind:filters`.
  - `RecordBulkActions.svelte` (307) — Set-field… / Delete bulk actions over selected ids.
  - `SchemaEditorButton.svelte` (82) — opens the schema editor for the current type (reads `currentMediaTypeStore`).
  - `FieldInput.svelte` — the shared schema-driven value input (all field types). **Reuse unchanged.**
  - `EditorPanelShell.svelte` (103) — fixed-width `<aside>` + prev/next chevrons + ←/→ keys + close. Used by the floating panel; the Explorer's inline detail will **not** use this shell (detail is a pane, not an aside) but can borrow its prev/next + key-handling logic.
  - `GlobalsEditorPane.svelte` (475) — bespoke globals editor. **Reuse unchanged.**
- **Stores:** `currentMediaType.ts` (read by `SchemaEditorButton`), `refreshTrigger.ts` (`refreshTrigger` + `schemaRefreshTrigger`), `settings.ts` (global `gridSize`, `autoSaveOnAdvance`).
- **API client wrappers** (`src/lib/api/client.ts`) — all present, **no new endpoints needed**:
  - `apiListMediaTypes`, `apiGetMediaType`, `apiCreateMediaType`, `apiRenameMediaType`, `apiDeleteMediaType`
  - `apiGetSchemaForType`, `apiListRecordsForType` (takes `{ filters, groupBy }`), `apiGetRecordByIdForType`, `apiUpdatePropertiesByIdForType`, `apiCreateRecordForType`, `apiDeleteRecordForType`
  - `apiBulkUpdatePropertiesForType`, `apiBulkDeleteForType`, `apiGetFieldValuesForType`
- **Known bug to fix as part of this work:** the list/tiles render the raw id (e.g. `55555555`) when a record has no `name` field, because the display falls back to `id`. The Explorer's list row title must use a **display-field resolution** (see §5). Relates to backlog Item 8.

## 3. Target architecture

### Routes

- **New:** `src/routes/media/+layout.svelte` — renders the **persistent rail** (type navigator) and a `{@render children()}` slot for the active pane. The rail must persist across type switches (no remount).
  - Alternatively, make the rail part of a `/media/+page.svelte` Explorer shell that owns all three panes and reads the active type/record from local state. **Chosen approach: a `+page.svelte` Explorer shell at `/media`** so all three panes share one component tree and state (simplest for in-page selection; revisit if/when Item 20 adds per-record routes). `/media/[typeId]` then either redirects into the shell with the type preselected, or is collapsed away.
  - **Decision for the build:** create `src/routes/media/+page.svelte` as the Explorer (rail + list + detail), and change the dashboard + any links to point at `/media?type=<id>` (query param, not a route segment — keeps it in-page, defers real routing to Item 20). Keep `/media/[typeId]/+page.svelte` as a thin redirect to `/media?type=<id>` so old links/bookmarks still work.

### Component tree (new)

```
src/routes/media/+page.svelte          ← Explorer shell: owns activeTypeId, selectedRecordId, rail-collapsed
└─ RecordsRail.svelte         (NEW)     ← type list, counts, +New type, Home/Settings, collapse toggle
└─ RecordListColumn.svelte    (NEW)     ← search + group/filter/sort controls + grouped record list + bulk bar
└─ RecordDetailPane.svelte    (NEW)     ← inline autosaving editor (refactor of RecordEditorPanel body)
   └─ FieldInput.svelte        (reuse)
└─ (globals branch) GlobalsEditorPane.svelte (reuse) rendered in place of list+detail
```

### State (Explorer shell, Svelte 5 runes)

- `activeTypeId: string` — from `?type=` query param on mount, else first type, else none. Writing it updates the URL via `replaceState` (no navigation).
- `types: MediaTypeSummary[]` + per-type counts (from `apiListMediaTypes`; counts may need `apiGetMediaTypeStats` or come from the summary — verify the summary shape).
- `records`, `loading`, `query`, `filters`, `groupBy`, `sort` — per active type (reload on change), mirroring today's `/media/[typeId]` page logic. **Lift this logic out of the existing page** rather than rewriting it.
- `selectedRecordId: string | null` — the open record. Detail pane reloads on change.
- `selectionMode` + `selectedIds: SvelteSet<string>` — multiselect for bulk actions (same model as today).
- `railCollapsed: boolean` — persisted (see §6).
- Keep `currentMediaTypeStore` in sync with `activeTypeId` so `SchemaEditorButton` keeps working.

## 4. Components — detail

### RecordsRail.svelte (NEW)

- Props: `types`, `activeTypeId`, `collapsed`, callbacks `onSelect(id)`, `onToggleCollapse()`, `onNewType()`.
- Expanded: brand "Records" + collapse `«`, a "Types" label, one row per type (generic glyph + name + count), `＋ New type` (opens the same new-type dialog the dashboard uses — extract or reuse `apiCreateMediaType` flow), footer Home (⌂ → `/`) + Settings (`SettingsButton`).
- Collapsed: `»` toggle, icon-only rows with `title` tooltips, active row highlighted, `＋` and footer icons.
- Use shadcn primitives; the rail itself can use `Sidebar`/`Sidebar.Root collapsible` **or** a hand-rolled flex column composed of `Button`s (Sidebar's collapsible has its own offcanvas behavior — evaluate; a simple width-toggled column is acceptable and likely cleaner here). Document the choice.

### RecordListColumn.svelte (NEW)

- Props: `typeId`, `schema`, `records`, `query`, `groupBy`, `filters`, `sort`, `selectionMode`, `selectedIds`, `selectedRecordId`, plus callbacks (`onOpen`, `onToggleSelect`, `onNewRecord`, `onChangeGroupBy`, `onChangeFilters`, `onChangeQuery`, `onToggleSelectionMode`, `onBulkChanged`).
- Header: type name, schema editor (`SchemaEditorButton`), `＋ New`, search input; a controls row with **Group by** (existing select), **Filter** (`RecordFilterPanel` in a `Popover` instead of a full sidebar), **Sort** (new, optional — can ship later; relates to backlog Item 9).
- Body: a scrollable list (not the tile `DataGrid`). Each row: **display-title** (see §5) + a muted subtitle (group value / a couple of fields / `updated`), warning badge if `missing_file_fields`. Group headers when `groupBy` is set (reuse the grouping logic from the current page's `groupedRecords`).
- Multiselect: when `selectionMode`, rows show a checkbox; the bulk bar renders `RecordBulkActions` (reused) in the header.

### RecordDetailPane.svelte (NEW — refactor of RecordEditorPanel)

- Render the **body** of today's `RecordEditorPanel` (the schema → `FieldInput` stack) as a pane, not inside `EditorPanelShell`.
- Header within the pane: display-title, "✓ saved / Saving…" status, prev/next (↑/↓) buttons that move `selectedRecordId` along the current list order, Delete (keep the `AlertDialog`).
- **Autosave:** replace the explicit Save button with debounced autosave:
  - Reuse `buildPatch()` / `isDirty` / `lastSavedPatch` logic from `RecordEditorPanel`.
  - On `formValues` change → debounce ~600ms → if `isDirty`, call `apiUpdatePropertiesByIdForType`, update `lastSavedPatch`, set status `saved`, fire `onchanged()` to refresh the list.
  - Flush pending save immediately on: blur of a field, prev/next, selecting another record, closing/switching type, and `beforeunload`. (Guard against overlapping saves.)
  - Drop the `autoSaveOnAdvance` setting dependence — autosave is now always on. Leave the setting in place for the Files editor unless we unify later.
  - Keep a `toast.error` on failure; success is silent (status hint only) to avoid toast spam.
- Prefer extracting the shared save/dirty/patch logic so `RecordEditorPanel` (still used? see §7) and the new pane don't drift.

## 5. Display-title fix (do this regardless)

- Add a **display-field resolver** used by both the list row title and the detail header: record `name` → chosen display field (per-type, see §6) → `group_by_value` → short id. Today's `displayName()` in `/media/[typeId]/+page.svelte` is the starting point; generalize it to accept a configurable display field.
- A **display-field selector** in the list header (mirrors Group by) lets the user choose which schema field titles a record when there's no `name`. This is the records half of backlog Item 8 — implement the minimum here (single display field), leave verbose multi-field cards to Item 8.
- Note: `apiListRecordsForType` returns `group_by_value` but not arbitrary field values. If the chosen display field ≠ name/group field, either extend the list response to include it (preferred, see Item 8 pointer) or fall back gracefully. For the first cut, restrict the display-field options to fields already available on the list item (name, group_by_value) to avoid an API change; expand under Item 8.

## 6. Persistence

- `railCollapsed`: add to the global settings store (`settings.ts` + the `.../settings` API + `settingsFile.ts`), like `gridSize`. Global is fine (it's a layout pref, not per-type).
- Display field / group-by / sort: **per session** for the first cut (local state in the shell). Per-type persistent defaults are a follow-up (overlaps Item 8/9) — note it, don't block on it.

## 7. Cleanup / migration

- After the Explorer ships and `/media/[typeId]` is a redirect:
  - `RecordEditorPanel.svelte` + `EditorPanelShell` usage on the records side is replaced by `RecordDetailPane`. Decide whether to delete `RecordEditorPanel` or keep it; if nothing else imports it, remove it (the Files side uses `FileEditorPanel`, not this). Confirm with a grep before deleting.
  - The old `/media/[typeId]/+page.svelte` body (Sidebar + DataGrid + floating panel) is removed; its records-loading logic moves into the shell / list column.
- Per the repo conventions: **update `docs/FEATURES.md` in the same change** (the records hub row, route changes, the new components, the autosave + display-field behavior). Update `test-fixtures/` only if on-disk structure changes — it does **not** here (no schema/settings-shape change except adding `railCollapsed` to settings; update the fixture's `settings.json` shape if the settings schema gains a required field — prefer making it optional).

## 8. Build order (incremental, each step shippable)

1. **Display-title fix + display-field selector** on the existing `/media/[typeId]` page (small, immediately fixes the id-instead-of-title bug; no layout change yet).
2. **Explorer shell + RecordsRail** at `/media` with `?type=` selection; render the _existing_ list/detail inside it first (rail navigation working, everything else unchanged). Add `/media/[typeId]` → `/media?type=` redirect; update dashboard links.
3. **RecordListColumn** — replace the tile `DataGrid` with the list column (search/group/filter-in-popover + grouped rows + bulk bar via `RecordBulkActions`).
4. **RecordDetailPane + autosave** — refactor the editor into the inline pane; remove the explicit Save button; add the saved/saving status + ↑/↓.
5. **Rail collapse/expand** + persisted `railCollapsed`.
6. **Polish:** empty states (empty type, no selection), keyboard nav (↑/↓ list, Enter to focus detail), globals branch (rail entry → `GlobalsEditorPane` in the detail area).
7. **Docs + cleanup:** `FEATURES.md`, remove dead `RecordEditorPanel`/`EditorPanelShell`-on-records if unused, `npm run check` + `npm run lint` + `npm run test`.

## 9. Testing

- Unit: any extracted pure logic (display-field resolver, patch/dirty) gets a vitest test.
- Manual end-to-end via the `test-ui-feature` skill (builds + serves `test-fixtures/` → `test-data/`, drives headless Chromium). Verify: rail switches types; record titles show real names (not ids); list group/filter/search; autosave persists across record switches and reload; bulk set-field/delete; collapse persists; globals still opens; `/media/notes` (old URL) redirects.
- The fixture has types `notes` + `globals` and a dangling file reference (missing-files warning) — exercise the warning badge on a list row.

## 10. Deferred (added to FUTURE_CHANGES.md)

- **Item 8** — verbose multi-field display / arbitrary display field needing a richer list response.
- **Item 9** — explicit sort control (the list column leaves room for it).
- **Item 20** — per-record deep-link routing (`/media/[typeId]/[recordId]`); replaces the `?type=` query approach.
- **Item 25** — globals panel overhaul (its detail-area rendering can improve then).
- **Item 28 (NEW)** — per-type/per-class icon picker (records + media).
- **Item 29 (NEW)** — Records Explorer mobile/narrow drill-down layout.
