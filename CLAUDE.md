# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`media-manager` is a **local-first** SvelteKit + Svelte 5 app for managing metadata over media files. It ships as a Node server (via `adapter-node`) and is usually launched through the `media-manager` CLI. There is no database — all state lives on disk as JSON under a single data root.

**File-first model (current).** Files (blobs) are the primary entity; classification is an opt-in layer. A **class** is a schema + opt-in per-blob metadata (`media/classes/<id>.json`), for any file type. Membership is binary (member / not-member) — there is **no** linked/unlinked/excluded tri-state and no per-extension gating. The reserved `files` blob_store dissolved into the **`media/` hub** ("All Files"); `globals` stays as a `json` singleton on the records side. `json`-kind media types (records, no file attachment) remain top-level folders — their `records/` reorg is deferred (`docs/FUTURE_CHANGES.md` Item 18). See `docs/FILE_FIRST_CLASSES.md` for the full design.

## Commands

```bash
npm run dev          # dev server with hot reload — REQUIRES MEDIA_MANAGER_ROOT set
npm run build        # production build into build/
npm run start        # node build (MEDIA_MANAGER_ROOT must be in env)
npm run check        # svelte-kit sync + svelte-check (type checking)
npm run lint         # prettier --check + eslint
npm run format       # prettier --write .
npm run test         # vitest run (one-shot)
npm run test:watch   # vitest watch
```

Run a single test file: `npx vitest run src/lib/storage/classRepo.test.ts`. Tests use `environment: 'node'` and match `src/**/*.{test,spec}.{ts,js}`.

**Nothing works without a data root.** Dev: `MEDIA_MANAGER_ROOT=./my-data npm run dev` (create the folder first). Built app: `node bin/media-manager.js /abs/path/to/my-data` (the CLI sets `MEDIA_MANAGER_ROOT`, defaults `BODY_SIZE_LIMIT` to ~100 MiB, and opens the browser unless `--no-open`). Server listens on `PORT` (default 3000).

`npm run upgrade-data -- <root>` (add `--apply` to write) migrates an existing data root to current conventions — see `scripts/upgrade-data.mjs`.

### Testing features in the built app (manual)

`npm run test` is **unit tests only (vitest)** — it does not run the app. To actually exercise a feature end-to-end you must run the built Node server against a data root. The flow is **two-stage** and easy to get wrong:

```bash
npm run build                         # produces build/ (the shipped Node server)
node bin/media-manager.js <root-dir>  # CLI sets MEDIA_MANAGER_ROOT, defaults BODY_SIZE_LIMIT (~100 MiB),
                                      # opens the browser unless --no-open; server on PORT (default 3000)
# equivalently: MEDIA_MANAGER_ROOT=<root-dir> node build
```

**Running the app mutates its data root** — it heals the manifest/`settings.json`, writes class files + `data.json`, and can rename or strip blob references. Never test against a folder you care about; test against a throwaway copy.

The canonical way to do this is the in-repo fixture:

```bash
npm run test:serve            # builds if needed, copies test-fixtures/ -> gitignored test-data/, serves it
npm run test:serve -- --no-open
```

`test-fixtures/` is a **pristine committed seed** in the file-first layout: a `media/` hub (blobs + `manifest.json` + two classes, `images` and `documents`) plus top-level `json` types (`notes`, `globals`). It includes a deliberately dangling `file`-reference to exercise the missing-files warning. `scripts/serve-test.mjs` copies it to the gitignored `test-data/` working copy before each run, so runs never dirty git. See `test-fixtures/README.md`.

To **drive the UI and capture it** for a running feature, use Playwright (devDependency) via the `scripts/ui-capture.mjs` helper — it drives headless Chromium and saves **PNG screenshots** of any state (including mid-interaction states the URL doesn't encode) and/or a **WebM video** of a multi-step flow (`launchUi({ video: true })`) to the gitignored `.screenshots/` folder, returning absolute paths. One-time: `npx playwright install chromium` (or set `PW_CHANNEL=chrome` to reuse the system browser). The `test-ui-feature` skill (`.claude/skills/`) wraps this whole flow.

## Required reading before behavior changes

`docs/FEATURES.md` is the **authoritative feature map**: per-feature status, primary owning files, the full HTTP API index, and intentional-vs-bug design notes. The `.cursor/rules/features-registry.mdc` rule (alwaysApply) mandates reading it before touching product behavior/routing/APIs/storage and **updating it in the same change** when behavior, routes, media-kind semantics, or owning files change. `docs/FUTURE_CHANGES.md` is a non-committal backlog — do not treat it as the shipped feature set.

When a change alters on-disk structure — `settings.json` / data-file layout, reserved-group behavior, or media-kind semantics — **update the `test-fixtures/` seed in the same change** (regenerate it by serving a scratch root and recreating the types, then copy back), the same discipline that applies to `docs/FEATURES.md`.

## Architecture

### On-disk layout and discovery

```
<root>/
├─ media/
│  ├─ manifest.json     # blob registry + derived membership index (classes[])
│  ├─ files/            # the global blob dir, any file type
│  ├─ classes/<id>.json # { schema, config, records } — SOURCE OF TRUTH per class
│  └─ settings.json     # media-wide prefs (class ordering, defaults)
├─ <jsonType>/{settings.json,data.json}   # `json` media types (top-level)
└─ globals/             # the reserved `json` singleton
```

`listClassIds()` scans `media/classes/` (the stem is the class id). `listMediaTypeIds()` scans the root for `json`-type folders (skipping `media/`). A class id / typeId is fixed at creation; the renamable `displayName` lives in the class `config` / type `settings`.

### Classes and membership (critical design invariant)

**Every blob lives in ONE dir: `media/files/` (`getGlobalFilesDir()`), registered in `media/manifest.json` (`manifest.ts`)** which gives it a stable workspace-scoped **id** (UUID — the manifest key), its current filename, intrinsic dims, and a **derived `classes[]` membership index**. A blob is a **member** of a class iff that class file (`classRepo.ts`) has a record keyed by its id; `records` are keyed by `file_id`, and a class row's `id` **is** that blob's manifest id. The same id appears in every class referencing the blob — **overlap is intentional.** Consequences (all expected):

- **Opt-in:** a blob is simply not a member until added; adding a class costs zero work against existing files. **Unclassified** = empty `classes[]`. No exclude, no `unlinked`.
- Class files are the source of truth; `manifest.classes[]` is a cache. On membership write both update atomically; on list, a **mtime-gated resync** rebuilds the index from class files if any is newer (catches hand edits). Lock order: **manifest lock before any class lock**.
- Every list call **lazy-heals** the manifest against disk (`reconcile`): new blobs get an id, vanished blobs are flagged `missing: true` (kept); the response carries `healed: { added, missing }`.
- Renaming a blob is **O(1)** (`renameBlobById` → `manifest.renameFileId`): rename on disk + one manifest entry; every `id` reference is unaffected.
- Deleting a blob from disk drops its manifest entry and strips its member record from **every** class (`deleteFromDiskById`). Rare, confirmed.
- Deleting a class removes its file and strips its id from `manifest.classes[]`; blobs are untouched.

Migration to this layout is explicit-only (`npm run upgrade-data -- <root> --apply`, step 5 in `scripts/upgrade-data.mjs`).

### Reserved types

Only `globals` (auto-created `json` singleton) is reserved (`RESERVED_TYPE_IDS`, `mediaTypes.ts`); it cannot be user-created, renamed, or deleted — enforced in the storage layer and API guards via `ensureGlobalsGroupExists()`. The old `files` blob_store type is gone — `media/` is the hub, not a media type. There are no reserved classes.

**Globals must keep feature parity with `json` records.** `globals` is a `json`-kind singleton, but its editor (`GlobalsEditorPane.svelte`) is a separate free-form implementation (no schema). Because there is no schema, per-field metadata is persisted in two reserved record keys (`src/lib/core/fieldKeys.ts`): `__field_kinds` (key → field UI type) and `__field_meta` (key → `{ options, multiselect, itemType }`); the server builds a **synthetic schema** from `__field_kinds` (`jsonRepo.ts: globalsSyntheticSchema`) so schema-driven read logic (url normalization, `_missing_files` annotation) applies to globals too. As of now globals supports **all the same field types and features as regular json records** — every `FieldType` (`string | number | boolean | dropdown` with options + multiselect `| list` with item types `| url | file`), the file picker, and missing-file indicators. When adding a feature to `json`/`JsonEditorPane`, mirror it in `GlobalsEditorPane` (storing any new per-field metadata in `__field_meta`); treat any gap as a bug to close, not intended behavior.

### Storage layer (`src/lib/storage/`)

- `paths.ts` — `media/` resolution: `getGlobalFilesDir()` (`media/files`), `getManifestPath()` (`media/manifest.json`), `getClassesDir()`/`getClassFilePath(id)`, `getMediaSettingsPath()`, `listClassIds()`; plus `getMediaTypePaths`/`listMediaTypeIds` for top-level `json` types.
- `classRepo.ts` — class persistence + the file-first repo: class CRUD, schema editing, opt-in membership (`addMembers`/`removeMembers`), per-record metadata, `listAllFiles` (manifest-driven hub), `listClassMembers` (one-class catalog view), per-blob ops (`renameBlobById`, `deleteFromDiskById`, `getFilenameForId`), `listMissingFileReferences`.
- `manifest.ts` — global blob manifest (`media/manifest.json`): id registry + `classes[]` index with `mintFileId`/`renameFileId`/`removeFileId`/`reconcile` (lazy heal), `setClassMembership`/`removeClassFromIndex`/`applyMembershipIndex` (resync), atomic under a manifest lock taken before any class lock.
- `jsonRepo.ts` — `json`-kind record persistence (records side; unchanged by the redesign).
- `settingsFile.ts` — read/write a `json` type's `settings.json` (now `json`-only).
- `mediaTypes.ts` — `json` type CRUD + `ensureGlobalsGroupExists`; `RESERVED_TYPE_IDS = {globals}`.
- `lock.ts` — `withFileLock` coarse `.lock`-file mutex protecting JSON writes; **single-node only**.
- `json.ts` — atomic JSON writes.
- `migrate.ts` — legacy→canonical record/schema normalization used by `jsonRepo` and the `upgrade-data` migration.
- `filenames.ts` — `assertSafeBasename` / `assertSafeImageFilename` traversal guards.

### Server / API

`src/lib/server/imageRepo.ts` validates a typeId/class id against `/^[a-zA-Z0-9_-]+$/` (traversal guard); `getMediaTypeRepo` now always returns a `JsonRepo` (top-level types are `json`). The surface is split (full index in FEATURES.md):

- **`/api/files/...`** — the blob/hub surface: `GET /api/files` (All Files, `?classIds&match&unclassified&query`), `upload`, `[id]/blob`, `[id]/rename`, `delete` (bulk from disk), `[id]/metadata(+/strip)`, `[id]/classes` (per-file editor sections + usage), `missing` (global warning).
- **`/api/classes/...`** — `GET`/`POST` classes, `[id]` (GET/PATCH config/DELETE), `[id]/members` (GET catalog / POST add / DELETE remove), `[id]/schema` (GET/POST/PATCH/PUT/DELETE), `[id]/records/[fileId]` (GET/PATCH), `[id]/records/bulk-update`, `[id]/field-values`.
- **`/api/media-types/[typeId]/...`** — `json` types only (records list/CRUD, schema, settings, stats); `globals/record`. Legacy `/api/images`, `/api/schema`, `/api/config` were removed.

Client wrappers: `src/lib/api/files.ts` (files/classes) + the json-side `*ForType` wrappers in `src/lib/api/client.ts`.

### Image processing (upload + EXIF), `src/lib/server/fileMetadata.ts`

Server-side image handling lives outside the repo layer:

- **Upload** (`/api/files/upload/+server.ts`) is per-blob (any file type): HEIC/HEIF → JPEG via `heic-convert` before saving; other types written as-is, then registered in the manifest.
- **EXIF metadata** is read/stripped via `exiftool-vendored` (`fileMetadata.ts`), exposed per-blob through `/api/files/[id]/metadata` and `.../strip` (`mode: 'all' | 'gps'`). ExifTool rejects files whose extension disagrees with content, so `fileMetadata.ts` sniffs **magic bytes** first.
- `ALLOWED_IMAGE_EXTENSIONS` / `ALLOWED_IMAGE_MIME_TYPES` are defined in `src/lib/core/images.ts` (client+server safe); `src/lib/storage/filenames.ts` re-validates persisted filenames to a safe basename.
- Note: `sharp` is still a declared dependency but is **not** referenced in `src/` — don't reach for it without checking.

### Frontend

- `/` is the **dashboard** (`src/routes/+page.svelte`): a `Card` overview of All Files + every class + every `json` record type, each drilling into its view, plus toolbar actions `+ New class`, `+ New record type`, and global `Settings` (`SettingsButton`).
- `/files` is the **All Files hub** (`src/routes/files/+page.svelte`): shadcn `Sidebar` with the class filter list (multi-select OR/AND + `Unclassified`), per-class `⋯` menu (Edit schema / Settings / Delete via `ClassSchemaDialog.svelte` + `ClassSettingsDialog.svelte` + delete `AlertDialog`), **the filename search + match-any/all toggle (in the sidebar)**, the shared `DataGrid` of tiles with class chips (group-by + size live in the top toolbar for the catalog view), bulk add/remove-to-class + delete-from-disk, and the global missing-files warning. `?class=<id>` opens directly in that class's catalog view; selecting a single class is the same catalog view. Clicking a file opens `FileEditorPanel.svelte` (one section per class via the shared `FieldInput.svelte`, plus rename + the rich EXIF `MetadataButton` (images only) + add/remove-to-class + **prev/next chevrons & ←/→ keys** with an autosave-on-advance toggle).
- **Shared UI components (use these — don't fork):** `src/lib/components/data-grid/DataGrid.svelte` (+ `types.ts`) is the single presentational tile grid — each host maps its rows to the side-agnostic `GridItem` and injects toolbar/bulk controls via snippets. `FieldInput.svelte` is the single schema-driven value input (all `FieldType`s incl. the rich list/url editor + the `FilePicker` file field), used by `FileEditorPanel`, `JsonEditorPane`, and `GlobalsEditorPane` (globals feeds it a synthetic `FieldDefinition`). `schema-editor/SchemaEditorBody.svelte` is the single add/edit/delete-field UI, driven by an injected `SchemaEditorAdapter`; `ClassSchemaDialog.svelte` (classes) and `SchemaEditorButton.svelte` (json) are thin wrappers. `FilePicker.svelte` lists blobs from `/api/files` (the old `blob_store`-discovery path is gone). `ClassFieldInput.svelte` was removed (superseded by `FieldInput`).
- `/media/[typeId]` serves **only** `json` types via `JsonEditorPane` / `GlobalsEditorPane`, reachable from the dashboard/hub, behind the slimmed `AppSidebar.svelte` shell (records list + multi-filter panel + search + new-record + schema/settings + nav). The legacy `ImageEditorPane`/`ImageViewGrid` components and the images/blob_store/linked-unlinked-excluded/upload machinery were **removed** with the file-first cleanup (blobs live in `/files`); the `MetadataButton` was kept, repointed to the file-first `/api/files` surface, and now lives in `FileEditorPanel`. The `json` record grid still uses `JsonRecordGrid.svelte` (not yet migrated to `DataGrid`).
- Core (client+server safe, no Node imports): `src/lib/core/` — Zod DTOs (`types.ts`, incl. `ClassFile`/`FileItem`), `filters.ts`, `ids.ts`, `mediaKinds.ts`, `fieldKeys.ts`.
- State: `src/lib/state/selection.svelte.ts` (runes) + `src/lib/stores/`.
- UI primitives under `src/lib/components/ui/` are shadcn-svelte (bits-ui) components via `components.json`; prefer composing these.

## Conventions

- **shadcn-svelte for all UI** (non-negotiable): every interactive/form element must compose a primitive from `src/lib/components/ui/` — `Button`, `Input`, `Label`, `Checkbox`, `Select`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Sidebar`, `Card`, `Separator`, etc. **Do not** hand-roll `<button>` / `<input>` / `<select>` / nav markup styled with Tailwind when a primitive exists. Match the established import style — `import * as Dialog from '$lib/components/ui/dialog/index.js'`, `import { Button } from '$lib/components/ui/button/index.js'`. Reference implementations: `SchemaEditorButton.svelte`, `JsonRecordGrid.svelte`. (Bare elements are acceptable only where no primitive exists — e.g. a `<textarea>` for long text, or a hidden `<input type="file">`.)
- **Checkbox/Label association:** never nest a shadcn `Checkbox` inside a `<Label>` (or a wrapping `Label` without `for`) — the label re-dispatches the click to the checkbox and cancels the toggle (you can check but not uncheck). Use **sibling** `Checkbox id="x"` + `Label for="x"`.
- **Svelte 5 only** (`.cursor/rules/svelte5.mdc`): use runes (`$state`, `$derived`, `$effect`, `$props`) — not legacy `export let` / reactive `$:`.
- **Document new functions** (`.cursor/rules/document.mdc`): the codebase uses rich JSDoc with `@param`, use-case, and a "Concerns / future improvements" section. Match that density.
- Field values: `url`-type fields are `{ display_name, url }` (`UrlValue`); legacy plain strings are normalized via `normalizeUrlValue`. Records use snake_case keys on disk; every record is keyed by `id` (for file-backed rows that id is the blob's manifest id, with the filename resolved from the manifest, not stored), `last_modified` is an ISO string. A `file`-type field value is a manifest id reference.
- Schema field types: `string | number | boolean | dropdown | list | url | file` (`FieldTypeSchema`).
