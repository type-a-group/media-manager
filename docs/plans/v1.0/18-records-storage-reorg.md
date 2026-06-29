# Item 18 — Records Storage Reorganization (+ other storage organization)

> 1.0 brief. Backlog: [Item 18](../../FUTURE_CHANGES.md#shipped--folded) (tombstone). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ✅ shipped 2026-06-28.** Built per the [HTML plan](18-records-storage-reorg-plan.html) across 5 slices; see the verification checklist below.

## Backlog snapshot

```yaml
status: ready # OQs resolved in the interview; build gate = approved HTML plan
size: M
usefulness: 2
priority: low
files: [src/lib/storage/paths.ts, src/lib/storage/jsonRepo.ts, src/lib/storage/mediaSettings.ts, src/lib/storage/settingsFile.ts, scripts/upgrade-data.mjs]
depends_on: []
open_questions: 0
acceptance:
  - json types move under <root>/records/<typeId>/{settings.json,data.json}; media/ untouched
  - app-wide prefs hoist to <root>/settings.json; media/settings.json keeps only classOrder; records/settings.json created with a dormant typeOrder
  - globals stays the reserved top-level <root>/globals/ singleton
  - dead dataFileName field dropped; data.json hardcoded
  - upgrade-data step (dry-run default, --apply) migrates the flat layout idempotently; app reads only the new layout and fails loudly on the old one (no dual-read)
  - test-fixtures reseeded; FEATURES.md + CLAUDE.md layout section updated
```

## What & why

Parallel to the file-first `media/` reorg (which is settled): move the `json`-kind side under a top-level **`records/`** folder (per-type subfolders), instead of today's scattered top-level per-type folders. Internal layout change, **low direct user value** — its worth is consistency and a cleaner data root, and it sets up other storage tidy-ups. Grouped with "any other storage organization," so the interview swept for adjacent layout cleanups to batch into one migration.

## Resolved decisions (Phase 1 interview — DONE)

The three original open questions are closed, plus the storage-wart sweep:

1. **Where `globals` fits** → **stays top-level** (`<root>/globals/`). It's the reserved `json` singleton, already resolved via a hardcoded `path.join(rootDir, 'globals')` in `mediaTypes.ts`; keeping it top-level matches that and the special-casing in `RESERVED_TYPE_IDS`.
2. **Per-type subfolders + settings split** → each json type is its own subfolder `records/<typeId>/{settings.json, data.json}`. A new **`records/settings.json`** is created now for cross-type prefs, carrying a **dormant `typeOrder`** field (latent parity with media's dormant `classOrder`). Per-type `settings.json` keeps its own keys (displayName, schema, displayField, …).
3. **Migration** → **explicit `upgrade-data` only** (dry-run default, `--apply` to write), like the file-first migration. **No dual-read** — the app reads only the new layout and fails loudly with a "run upgrade-data" message if it detects the old flat layout. Keeps runtime code simple.

**Storage-wart sweep (folded in):**
- **`media/settings.json` is mislabeled** — it's actually *app-wide* settings (gridSize, autosave, rail, sort, verbose) plus the one media-specific key `classOrder`. **Hoist** the app-wide keys to a new **`<root>/settings.json`**; `media/settings.json` keeps only `classOrder`.
- **Dead `dataFileName` field** — every type's `settings.json` carries `dataFileName`, always `'data.json'`, never set otherwise. **Drop it**; hardcode `data.json` in `paths.ts`.

**Split out (not 1.0):** the actual reorder UX that *activates* `classOrder`/`typeOrder` (reorder UI in both rails + server-side sort-on-read) is a **feature, not a migration** → [Item 41](../../FUTURE_CHANGES.md#41--manual-ordering-of-classes--record-types-in-the-rails).

**Cut line:** file-first `media/` internals untouched; no type-ordering *feature* (just the dormant field); no dual-read compatibility.

## Build notes (Phase 3)

- Mostly `paths.ts` + `mediaSettings.ts` + `settingsFile.ts` + a migration step.
  - `paths.ts`: `getMediaTypePaths`/`listMediaTypeIds` resolve under `records/`; `listMediaTypeIds` scans `records/` and folds in the reserved top-level `globals`. Add `getAppSettingsPath()` (root) + `getRecordsSettingsPath()`. Drop the `dataFileName` indirection.
  - `mediaSettings.ts`: split app-wide keys (→ `<root>/settings.json`) from `classOrder` (stays `media/settings.json`). The `/api/settings` endpoint now backs `<root>/settings.json`.
  - `settingsFile.ts`: remove `dataFileName` from `MediaTypeSettingsFile`.
- Add an `upgrade-data` step (dry-run by default, `--apply` to write), mirroring the existing migration discipline; update `scripts/upgrade-data.mjs`. Add an **old-layout detection guard** at startup/list time that errors with a clear "run upgrade-data" message.
- **Update `test-fixtures/` in the same change** (CLAUDE.md rule) — the seed must reflect the new on-disk layout, and `serve-test.mjs` keeps working.
- Because nothing user-facing changes, the risk is entirely in migration correctness and lazy-heal/lock behaviour — test those hard.

## Verification stages (Phase 4)

- [ ] HTML plan approved with the resolved decisions + a before/after data-root tree + migration steps.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — `paths`/`jsonRepo` resolve the new layout; app-wide vs media vs records settings split reads/writes correctly; migration converts an old-layout fixture to the new one idempotently (running twice is a no-op); old-layout detection fires; lock order + lazy-heal preserved.
- [ ] `npm run upgrade-data -- <scratch-root>` (dry-run) then `--apply` on a **throwaway copy**; verify the data root matches the planned tree and the app serves it.
- [ ] `npm run test:serve` against the **updated** `test-fixtures/` — Records + Globals load and edit correctly post-reorg; app refuses an un-migrated old-layout root with the expected message.
- [ ] `FEATURES.md` + `test-fixtures/README.md` + `CLAUDE.md` on-disk-layout section updated; Item 18 → **Shipped & folded**; triage HTML synced.
