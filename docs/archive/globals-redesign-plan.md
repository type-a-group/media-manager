# Globals Editor Redesign — Implementation Plan

Status: **done** (built on the `global-files` branch). Companion to the visual brainstorm in
`docs/globals-redesign-ideas.html`. Rewrites the Globals editor into its own sub-app-flavored
**sectioned property table** with field structure editing moved into a per-field menu.

---

## 1. Goal

Replace today's `GlobalsEditorPane.svelte` (a flat stack of bordered boxes that mixes a field's
_type dropdown + options_ with its _value_ in every row) with:

- **Collapsible sections** — fields are grouped into named, foldable sections.
- **Clean key → value rows** — each row shows only the field name and its value control.
- **Type/structure in a `⋮` menu** — rename, type, type-specific options (dropdown options /
  multiselect / list item-type), move-to-section, and delete live in a per-field popover. The same
  popover backs **+ Add field**.
- **Its own identity** — orange accent, a real heading, a settings `⚙`, consistent with Media/Records
  being sub-apps. (No rail for now — a single record doesn't need one; revisit if it sprawls.)

**Non-negotiable invariants carried over:** no schema, no on-disk format change beyond one new reserved
record key, autosave policy unchanged (`debouncedAutosave`, no Save button, no post-save reload), and
**globals keeps feature parity with `json` records** for every `FieldType` (CLAUDE.md “Reserved types”).

## 2. Locked design decisions

| Decision                 | Choice                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Layout                   | One design: **collapsible sectioned property table** (merge of brainstorm A + C).             |
| Field type selection     | **In the `⋮` menu only** — not inline. No inline-type-chip mode.                              |
| Section display          | **Collapsible headers only** — dropped the flat-vs-cards toggle.                              |
| Field order              | **Manual** (drag), with `⋮ → Move up/down` as the accessible fallback.                        |
| Persistence of structure | **One new reserved record key `__layout`** on the globals record. No `settings.json` changes. |

## 3. Data model — the `__layout` reserved key

Globals has no schema, so structure rides alongside the data in a reserved, JSON-encoded record key,
exactly like the existing `__field_kinds` / `__field_meta` (`src/lib/core/fieldKeys.ts`). One key holds
sections, their order, per-section field order/membership, collapse state, and the field-sort pref:

```jsonc
// value of rec["__layout"] (a JSON string)
{
	"sections": [
		{
			"id": "sec_site",
			"name": "Site",
			"collapsed": false,
			"fields": ["site_title", "tagline", "theme", "maintenance_mode"]
		},
		{ "id": "sec_links", "name": "Links", "collapsed": false, "fields": ["social_links"] },
		{
			"id": "sec_about",
			"name": "About",
			"collapsed": true,
			"fields": ["about_photo", "contact_email"]
		}
	],
	"defaultSectionId": "sec_site", // where the top-level "+ Add field" drops new fields
	"fieldSort": "manual" // "manual" | "alpha"
}
```

- **Section identity is `id`** (generated, e.g. `sec_` + nanoid via `src/lib/core/ids.ts`); `name` is a
  rename-only display label, so renaming never re-keys anything.
- **Type stays in `__field_kinds`; options/multiselect/itemType stay in `__field_meta`.** `__layout`
  only owns grouping/order/collapse. No data migration: a record with no `__layout` renders as one
  default section (see reconcile below).

### Reconcile on load (mirrors the app's lazy-heal pattern)

When the editor loads the record it normalizes `__layout` against the actual editable keys:

1. Drop any field id in a section that no longer exists in the data (stale reference).
2. Collect editable keys present in data but in **no** section → append to `defaultSectionId` (or the
   first section; if there are zero sections, create a single `"General"` section).
3. De-dupe a key that somehow appears in two sections (keep first).

This makes hand-edits to `globals/data.json` and pre-`__layout` records “just work.”

## 4. File-by-file changes

### `src/lib/core/fieldKeys.ts`

- Add `export const GLOBALS_LAYOUT_KEY = '__layout';`
- Add it to `GLOBALS_META_KEYS` so it is excluded from the editable/iterated field set everywhere that
  set is consulted.
- (Add a `nextSectionId()` helper or just reuse `ids.ts` in the component.)

### `src/lib/storage/jsonRepo.ts`

- **No behavioral change required.** `globalsSyntheticSchema()` only reads `__field_kinds`, so `__layout`
  is ignored by schema-driven read logic and never becomes a synthetic field. Add one sentence to the
  `globalsSyntheticSchema` doc-comment noting `__layout` is reserved/ignored so nobody “fixes” it later.

### `src/routes/api/media-types/globals/record/+server.ts` & `src/lib/api/client.ts`

- **No change.** The free-form `POST /record` patch already round-trips arbitrary keys (and `null`
  deletes a key). The editor reads with `apiGetGlobalsRecord()` and writes `__layout` (plus values,
  `__field_kinds`, `__field_meta`) via `apiUpdateGlobalsRecord()` as it does today.

### `src/lib/components/GlobalsEditorPane.svelte` (full rewrite)

The orchestrator. Keeps the existing load/save/autosave skeleton; swaps the body.

- **Load:** parse `__field_kinds`, `__field_meta`, **and `__layout`**; run reconcile (§3); seed
  `savedSnapshot`.
- **State:** `formValues`, `fieldKinds`, `fieldMeta` (as today) **plus** `layout` (`sections[]`,
  `defaultSectionId`, `fieldSort`).
- **Snapshot/dirty:** extend `currentSnapshot()` to include `layout` so reordering, renaming a section,
  collapsing, or moving a field marks the pane dirty and autosaves.
- **Save:** unchanged policy. Build the patch from `formValues` (+ `null` for `deletedKeys`),
  `__field_kinds`, `__field_meta`, **and `__layout` = JSON.stringify(layout)**; advance the baseline in
  place (no reload). Reuse the exact comment block warning against post-save reload.
- **Render:** a toolbar (heading “Globals”, counts, filter input, **+ Add field**, **⚙**, Saving…/Saved)
  over a list of `GlobalsSection` components, then **+ New section**.
- Keep `beforeunload` / `onDestroy` flush.

### New child components (under `src/lib/components/globals/`)

| Component                | Responsibility                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GlobalsSection.svelte`  | One collapsible section. Wraps shadcn **Collapsible**; header = drag grip + caret + name + count + section `⋮` (**DropdownMenu**: Rename, Move up/down, Add field here, Delete). Body = the field rows + a per-section “+ Add field”. Emits move/rename/delete/collapse events up.                                                                            |
| `GlobalsFieldRow.svelte` | One key → value row. Left: drag grip + field name. Middle: existing **`FieldInput.svelte`** fed a synthetic `FieldDefinition` (reuse current `syntheticDef()` logic). Right: the field `⋮` trigger.                                                                                                                                                           |
| `FieldMenu.svelte`       | The per-field structure editor in a shadcn **Popover** (also the Add-field UI). Inputs: Name (rename), Type (**Select**), Section (**Select** of section names), and type-specific config: dropdown Options + “Allow multiple” (**Checkbox**, sibling+`for` per CLAUDE.md), list item-type (**Select**). Footer: Delete (via **AlertDialog** confirm) + Done. |

Reuse, do **not** fork: `FieldInput.svelte` for values; lift the dropdown-options / list-item-type
sub-UI from the schema editor rather than re-rolling it; `EditorPanelShell` is **not** used (globals is a
full pane, not a side panel).

### Drag & drop

- Native HTML5 DnD (`draggable`, `dragstart`/`dragover`/`drop`) keyed off the `⠿` grips — **no new
  dependency** (`@masonry-grid`/`sharp` are unused; don’t add a dnd lib). Reorder fields within a
  section, move a field across sections, and reorder sections.
- Accessible fallback for every drag action: `⋮ → Move up / Move down` (fields) and section `⋮ → Move up
/ down`, plus `⋮ → Section ▾` to relocate a field without dragging.

### Settings `⚙` (thin — a small Dialog)

With type-in-menu and collapsible-only locked, the gear shrinks to:

- **Field sort:** Manual ↔ A→Z (writes `layout.fieldSort`; `alpha` sorts within each section on render).
- **Default new-field section** (writes `layout.defaultSectionId`).
- **Export / import JSON:** download/paste the whole globals record — genuinely useful for a config store.
- _Section management_ stays **inline** (section `⋮`), not duplicated here.

Everything the gear touches lives in `__layout` / the record — **no `MediaTypeSettingsFile` change**, so
`globals/settings.json` is untouched.

## 5. Edge cases

- **Empty section** persists (identity is in `__layout`, not inferred from members).
- **Delete a section** → AlertDialog: “Move its fields to Default” (non-destructive, default) vs “Delete
  the fields too.” Never silently drop data.
- **Rename collision** of a field key → block + toast (as today’s `addField` does).
- **Reserved keys** (`id`, `last_modified`, `_missing_files`, `__field_kinds`, `__field_meta`,
  `__layout`) stay hidden from the field list and rejected as new field names.
- **Missing-file indicator** still flows through `_missing_files` + `FieldInput`’s `missing` prop — keep
  the current wiring.
- **Filter input** filters visible rows by key/value; empty sections during a filter collapse to a hint,
  not disappear.

## 6. Testing

- **Unit (vitest):** a small pure `reconcileLayout(layout, editableKeys)` helper extracted from the
  component (so it’s testable without the DOM) — cover: no `__layout`, stale field ref, orphan key
  appended to default, duplicate key, zero sections → “General”. File: `src/lib/core/globalsLayout.test.ts`
  (put the helper in `src/lib/core/` so it’s client+server-safe and Node-testable).
- **Manual / UI:** use the `test-ui-feature` skill (build → serve `test-fixtures/` → Playwright) to
  screenshot: collapsed/expanded sections, the field `⋮` popover, add-field, and a drag move. Capture a
  short WebM of moving a field between sections.

## 7. Fixture update (required, same change)

Per CLAUDE.md, on-disk structure changes must update the seed. Extend
`test-fixtures/globals/data.json` so the singleton record carries a couple of typed fields plus
`__field_kinds`, `__field_meta`, and a `__layout` with ≥2 sections (one collapsed) — so a fresh
`npm run test:serve` exercises sections, the menu, and reconcile out of the box.

## 8. Docs to update (same change)

- `docs/FEATURES.md` — Globals row: note the sectioned editor, `__layout` reserved key, `⋮` field menu,
  and the thin settings gear (it currently must be updated whenever media-kind/owning-file semantics
  change).
- `docs/globals-redesign-ideas.html` — leave as the design artifact; optionally link it from here.
- This file — flip Status to “in progress / done” as it lands.

## 9. Build order

1. **Rows + field menu:** rewrite `GlobalsEditorPane` to render one default section of `GlobalsFieldRow`
   with the `FieldMenu` popover doing type/options/rename/delete; drop the inline type select + bottom
   add-field strip. (No sections yet — proves the per-field menu.)
2. **Sections + `__layout`:** add the `GLOBALS_LAYOUT_KEY`, the reconcile helper + its test, section
   rendering with shadcn Collapsible, snapshot/save wiring.
3. **Reorder/move:** native DnD + the `⋮` move/section fallbacks; section CRUD (add/rename/delete-with-
   choice).
4. **Settings gear + fixture + FEATURES.md:** field-sort/default-section/export-import, seed update, docs.

## 10. Out of scope

- A left **rail** for groups (brainstorm option D) — additive later if the record grows; the section
  list already is the “groups” model.
- Any change to `json` records or the shared `EditorPanelShell` side panel.
- New runtime dependencies (DnD is native; UI is existing shadcn primitives).
