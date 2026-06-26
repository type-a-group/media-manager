# Records — Title + Subtitle (implementation plan)

Fix the broken "title by" and extend it into a configurable **title + subtitle** per record type.
Decisions: settings layout **Option A** (two dropdowns in the General tab); the configured
**subtitle field always shows** under each row (group value stays in the group header only).

Design doc: `docs/records-title-subtitle-plan.html`.

## Root cause of the current bug

`recordListTitle()` (`src/lib/core/recordDisplay.ts`) returns `item.name` before `item.title_value`,
so any type with a `name` field ignores the persisted title-by choice. Fix = resolve title/subtitle
server-side and trust `title_value` first on the client.

## Phase 1 — Storage

- `src/lib/storage/settingsFile.ts`: add `subtitleField?: string` to `MediaTypeSettingsFile`; read it
  in `readMediaTypeSettingsFileSync` (`typeof parsed.subtitleField === 'string' ? … : undefined`); add
  to the create + merge branches of `writeMediaTypeSettingsFile` (mirror `displayField`).

## Phase 2 — Server (jsonRepo.listRecords)

- `src/lib/storage/jsonRepo.ts`:
  - Accept `subtitleField?: string | null` param.
  - Resolve **effective title field**: `params.titleField ?? settings.displayField ?? defaultTitleField(schema)`
    where `defaultTitleField` = `'name'` if present, else first `string` field, else first user field, else null.
  - Resolve **effective subtitle field**: `params.subtitleField ?? settings.subtitleField ?? null`.
  - **Always** set `item.title_value` from the resolved title field (reuse `stringifyFieldValue`); set
    `item.subtitle_value` when a subtitle field resolves and is non-empty.
  - Keep `item.name` as-is (still handy), but resolution no longer depends on it.

## Phase 3 — Core DTO + resolvers

- `src/lib/core/types.ts`: add `subtitle_value: z.string().optional()` to `JsonListItemSchema`.
- `src/lib/core/recordDisplay.ts`:
  - `recordListTitle`: `title_value` → `name` → `group_by_value` → id slice (title_value first — kills the bug).
  - add `recordListSubtitle(item): string | null` → `subtitle_value?.trim() || null`.
  - `recordDetailTitle`: unchanged logic but ensure it honors the chosen title field already passed in.

## Phase 4 — API

- `src/routes/api/media-types/[typeId]/settings/+server.ts`: `SettingsPatchSchema` gains
  `subtitleField: z.string().max(256).optional()`; GET returns `subtitleField: settings.subtitleField ?? ''`;
  POST maps `patch.subtitleField = parsed.data.subtitleField || undefined`; return it.
- `src/routes/api/media-types/[typeId]/records/list/+server.ts`: read `subtitleField` query param, pass to repo.
- `src/lib/api/client.ts`: extend `apiGetTypeSettings` / `apiUpdateTypeSettings` return + patch with
  `subtitleField`; add `subtitleField?` to `apiListRecordsForType` params and set the query param.

## Phase 5 — Settings dialog (Option A)

- `src/lib/components/entity-settings/types.ts`: `EntityGeneralConfig`/adapter `load()` returns
  `subtitleBy`; `save()` takes `subtitleBy`. Add a `hasSubtitle` capability flag (true for record types).
- `src/lib/components/entity-settings/adapters.ts`: `typeSettingsAdapter` load/save `subtitleField` via the
  client wrappers. (`classSettingsAdapter` keeps `hasSubtitle:false` for now — Files rows aren't text rows.)
- `src/lib/components/entity-settings/EntitySettingsDialog.svelte`: under "Title rows by", add a
  "Subtitle (optional)" `Select` (with a "None" item) when `adapter.hasSubtitle`. Persist on save.

## Phase 6 — List rendering

- `src/lib/components/records/RecordListColumn.svelte`: replace the group-derived `rowSubtitle` with
  `recordListSubtitle(item)` (always the configured subtitle field); group value stays only in the sticky
  group header. Title via `recordListTitle` (now correct).
- `src/routes/media/+page.svelte`: thread `subtitleField` state like `titleField` (load from settings,
  pass to `apiListRecordsForType`, reload effect). Apply persisted subtitle on `loadSchema`.

## Phase 7 — Tests, fixtures, docs

- `src/lib/storage/settingsFile.test.ts`: add a `subtitleField` round-trip + clear test.
- `test-fixtures/notes/settings.json`: add `"subtitleField": "priority"` (demonstrates the feature).
- `docs/FEATURES.md`: update the records list-row + per-type settings rows.
- `CLAUDE.md`: note `subtitleField` alongside `displayField` in the records settings description.

## Verify

- `npm run check`, `npm run test`, `npm run build`.
- Playwright: open Notes, confirm title = title field and subtitle line renders; open ⋮ → Settings →
  General, change title/subtitle, confirm rows update; confirm grouping puts the group value only in the
  header.
