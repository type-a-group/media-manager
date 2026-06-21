# Unified Entity Settings — Implementation Plan

Status: **proposed** (awaiting approval before code)
Companion UI mockup: `docs/entity-settings-plan.html`

## Goal

One shared "entity settings" surface for **both** a Files _class_ and a Records _type_:

- A per-entity **⋮ menu** (Menu **Style 1**: `Settings…` + `Delete`) on each expanded rail/sidebar row.
- A single **tabbed dialog** (Option **A**: `General` / `Fields` / `Danger`) combining **rename**, **schema (fields)**, **title-by**, and **delete**.
- **Title-by** becomes a **persisted** per-entity setting and is **removed from the Records list header**.
- **Group-by** stays an ephemeral header control (unchanged).
- The Files sidebar and Records rail share **one rail shell** (two row modes); the Files sidebar becomes **collapsible**.
- When the rail is collapsed, the active entity's ⋮ is reachable from the **content-column header**.
- Disambiguate global **App settings** (footer gear) from per-entity settings via naming.

---

## Phase 0 — Persist "title by" for record types (backend)

Records' title-by is wired end-to-end already (`titleField` query → `listRecords` → `title_value` → `recordListTitle`) but **ephemeral** — it resets on every type switch. Make it sticky by persisting it like `ClassConfig.displayField`.

- `src/lib/storage/settingsFile.ts`
  - Add `displayField?: string` to `MediaTypeSettingsFile` (the title-by field).
  - Read it in `readMediaTypeSettingsFileSync` (and async reader if present); persist it through `writeMediaTypeSettingsFile`.
- `src/routes/api/media-types/[typeId]/settings/+server.ts`
  - `GET`: include `displayField` in the response.
  - `POST`: extend `SettingsPatchSchema` with `displayField: z.string().optional()`; carry it into the written `patch`.
- `src/lib/api/client.ts`
  - Add `apiGetTypeSettings(typeId)` (returns `{ displayName, displayField }`) and `apiUpdateTypeSettings(typeId, { displayName?, displayField? })` posting to the settings endpoint. (Rename can keep using the existing `apiRenameMediaType` PATCH, or route through this — pick one and use consistently; recommend funnel both through `apiUpdateTypeSettings`.)

No data migration required (additive, optional field). `recordListTitle` already handles `title_value`.

---

## Phase 1 — Shared `EntitySettingsDialog` (tabbed)

New: `src/lib/components/entity-settings/EntitySettingsDialog.svelte` + `types.ts`.

- Driven by an injected **`EntitySettingsAdapter`** so it works for both sides:
  - `noun: 'class' | 'record type'`
  - `getDisplayName(): Promise<string>` / `rename(name): Promise<void>`
  - `titleBy`: `{ value, options: {key,label}[], set(value) }` (label **"Title rows by"**)
  - `groupBy?` (**optional** — Files only, preserves existing `gridGroupByField`; Records omits it)
  - `schema: SchemaEditorAdapter` (reuse existing `SchemaEditorBody`)
  - `delete(): Promise<void>`
  - `onChanged()` callback (host refreshes rail names/counts + list)
- Layout (Option A): shadcn `Dialog` with shadcn `Tabs`:
  - **General** — display-name `Input`, title-by `Select`, (Files: group-by `Select`), `Save`.
  - **Fields** — `SchemaEditorBody` (the shared schema editor).
  - **Danger** — delete button → shadcn `AlertDialog` confirm.
- Title: **`{name} — settings`**. Subtitle: _"Settings for this {noun} — global preferences live in App settings."_
- Adapters:
  - `classSettingsAdapter` — wraps `apiGetClass` / `apiUpdateClassConfig` (`displayName`, `displayField`, `gridGroupByField`), the class schema adapter, `apiDeleteClass`.
  - `typeSettingsAdapter` — wraps `apiGetTypeSettings` / `apiUpdateTypeSettings`, the media-type schema adapter (from `SchemaEditorButton`'s existing wiring), `apiDeleteMediaType`.
- **Retire** the separate `ClassSettingsDialog.svelte` + `ClassSchemaDialog.svelte` (fold into the shared dialog) and `SchemaEditorButton.svelte`'s standalone button (schema now lives in the Fields tab).

---

## Phase 2 — Shared rail shell (two modes)

New: `src/lib/components/rail/EntityRail.svelte`.

- Shared chrome: collapsible `<aside>` (w-56 ↔ w-14 + width transition), header (title + collapse toggle), scrollable list region, footer (`Home` + **App settings**), `＋ New …` affordance, icon-only **tooltips** when collapsed. Compose shadcn `Button` / `Tooltip` / `DropdownMenu` inside.
- Props: `title`, `collapsed`, `onToggleCollapse`, `onNew`, `newLabel`, `items: RailItem[]`, `mode: 'navigate' | 'filter'`, `onSelect`, optional `onToggleCheck`; snippets: `rowMenu(item)` (the ⋮ dropdown content, expanded rows only), `extras` (filter-only controls, expanded only), `footer`.
  - `RailItem = { id, label, icon?, count?, selected }`.
  - `navigate` mode (Records): row = single-select `Button`.
  - `filter` mode (Files): row = `Checkbox` + label + count.
- **Records** (`src/lib/components/records/RecordsRail.svelte` → use `EntityRail` in `navigate` mode; thin RecordsRail down or remove).
- **Files** (`src/routes/files/+page.svelte`): replace `Sidebar.Root collapsible="none"` with `EntityRail` in `filter` mode; move `Unclassified`, match-all/any toggle, filename search, and cross-group controls into the `extras` snippet. Persist a `filesRailCollapsed` pref in the settings store (mirror `railCollapsed`).

---

## Phase 3 — Wire the ⋮ menu (Style 1) + content-header ⋮

- **Rail row ⋮** (expanded only), via `rowMenu` snippet → shadcn `DropdownMenu`:
  - `⚙ Settings…` → opens `EntitySettingsDialog` for that entity.
  - separator + `🗑 Delete {noun}` → `AlertDialog` confirm.
- **Content-header ⋮** (always reachable, incl. when rail collapsed):
  - Records: `RecordListColumn` header gets the same ⋮ for the active type. **Remove** `SchemaEditorButton` from the header (schema → dialog Fields tab) and **remove the "Title by" `Select`** from the controls row (→ dialog). Keep group-by + filter.
  - Files: content header shows the ⋮ for the active **single class** in catalog mode (`?class=`); hidden in multi-select/All-Files mode (expand the rail to act on a specific class).

---

## Phase 4 — Records page wiring (`src/routes/media/+page.svelte`)

- On `selectType(id)`: instead of resetting `titleField = ''`, **load the persisted `displayField`** from settings and seed `titleField` (sticky). Keep passing it to `apiListRecordsForType`.
- The header no longer mutates `titleField`; the dialog does. On dialog save → reload settings-derived `titleField` + `loadRecords()`.
- `loadSchema`'s auto-pick fallback stays as a default only when no persisted `displayField` exists.

---

## Phase 5 — App-settings vs entity-settings disambiguation

- Relabel the global `SettingsButton` text/tooltip from "Settings" to **"App settings"**.
- Entity dialog keeps the `{name} — settings` title + scope subtitle (Phase 1).

---

## Phase 6 — Docs, fixtures, tests, checks

- `docs/FEATURES.md` — update: records-type settings (rename/title-by/schema/delete unified), Files class settings now via shared dialog, the settings endpoint's new `displayField`, rail-collapse on Files. (Mandatory per features-registry rule.)
- `test-fixtures/` — add a `displayField` to one type's `settings.json` (e.g. `notes`) to exercise persisted title-by; re-copy seed. (On-disk additive change → fixture update required.)
- `docs/RECORDS_EXPLORER.md` + the `records-as-subapp` memory — note the unified settings + shared rail.
- Tests: `settingsFile` round-trips `displayField`; adapter wiring smoke where practical.
- Run `npm run check`, `npm run lint`, `npm run test`. Manual end-to-end via `test-ui-feature` skill (rail collapse, ⋮ menu, tabbed dialog, sticky title-by).

---

## Files touched (summary)

**Backend/storage:** `settingsFile.ts`, `settings/+server.ts`, `api/client.ts`.
**New shared UI:** `entity-settings/EntitySettingsDialog.svelte` + `types.ts`, `entity-settings/{classSettingsAdapter,typeSettingsAdapter}.ts`, `rail/EntityRail.svelte`.
**Edited UI:** `records/RecordsRail.svelte`, `records/RecordListColumn.svelte`, `routes/media/+page.svelte`, `routes/files/+page.svelte`, `SettingsButton.svelte`.
**Removed/folded:** `ClassSettingsDialog.svelte`, `ClassSchemaDialog.svelte`, standalone `SchemaEditorButton.svelte` button (logic reused as adapter).
**Docs/fixtures:** `docs/FEATURES.md`, `docs/RECORDS_EXPLORER.md`, `test-fixtures/notes/settings.json`, memory note.

## Open risks / notes

- **Group-by asymmetry:** Files persists `gridGroupByField`; Records keeps group-by ephemeral. Handled by making `groupBy` adapter-**optional** in the dialog (rendered only when provided).
- **Files content-header ⋮** only meaningful for a single active class; multi-select mode relies on expanding the rail. This is the part you flagged as possibly "not good" — low-cost to revisit since the ⋮ trigger is a shared component (can add a collapsed-icon popover later with no redesign).
- **shadcn convention:** the rail aside is structural; all interactive bits inside compose shadcn primitives (matches the existing `RecordsRail` precedent).

## Suggested commit slicing

1. Phase 0 (persist title-by) — backend + client, with `settingsFile` test.
2. Phase 1 (shared dialog + adapters) — swap Files over to it, delete old dialogs.
3. Phase 2 (shared rail shell) — Records then Files.
4. Phases 3–5 (⋮ wiring, header ⋮, page wiring, App-settings label).
5. Phase 6 (docs/fixtures/tests).
