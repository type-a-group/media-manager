# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`media-manager` is a **local-first** SvelteKit + Svelte 5 app for managing metadata over multiple media types. It ships as a Node server (via `adapter-node`) and is usually launched through the `media-manager` CLI. There is no database — all state lives on disk as JSON catalogs plus a shared blob directory under a single data root.

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

Run a single test file: `npx vitest run src/lib/storage/repo.test.ts`. Tests use `environment: 'node'` and match `src/**/*.{test,spec}.{ts,js}`.

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

**Running the app mutates its data root** — it heals `settings.json`, writes `data.json` / `image-data.json`, and can rename or strip blob references. Never test against a folder you care about; test against a throwaway copy.

The canonical way to do this is the in-repo fixture:

```bash
npm run test:serve            # builds if needed, copies test-fixtures/ -> gitignored test-data/, serves it
npm run test:serve -- --no-open
```

`test-fixtures/` is a **pristine committed seed** with one media type of every kind (`images`, `generic`, `json`, plus the reserved `files` blob_store and `globals` singleton) and a few tiny sample images. `scripts/serve-test.mjs` copies it to the gitignored `test-data/` working copy before each run, so runs never dirty git. See `test-fixtures/README.md`.

To **drive the UI and capture it** for a running feature, use Playwright (devDependency) via the `scripts/ui-capture.mjs` helper — it drives headless Chromium and saves **PNG screenshots** of any state (including mid-interaction states the URL doesn't encode) and/or a **WebM video** of a multi-step flow (`launchUi({ video: true })`) to the gitignored `.screenshots/` folder, returning absolute paths. One-time: `npx playwright install chromium` (or set `PW_CHANNEL=chrome` to reuse the system browser). The `test-ui-feature` skill (`.claude/skills/`) wraps this whole flow.

## Required reading before behavior changes

`docs/FEATURES.md` is the **authoritative feature map**: per-feature status, primary owning files, the full HTTP API index, and intentional-vs-bug design notes. The `.cursor/rules/features-registry.mdc` rule (alwaysApply) mandates reading it before touching product behavior/routing/APIs/storage and **updating it in the same change** when behavior, routes, media-kind semantics, or owning files change. `docs/FUTURE_CHANGES.md` is a non-committal backlog — do not treat it as the shipped feature set.

When a change alters on-disk structure — `settings.json` / data-file layout, reserved-group behavior, or media-kind semantics — **update the `test-fixtures/` seed in the same change** (regenerate it by serving a scratch root and recreating the types, then copy back), the same discipline that applies to `docs/FEATURES.md`.

## Architecture

### Data root and discovery

`MEDIA_MANAGER_ROOT` points at a root folder containing one **subfolder per media type**. A subfolder is a valid media type iff it has a `settings.json` with a recognized `kind`. There is no manifest — `listMediaTypeIds()` scans the root. The folder name **is** the `typeId` (URL/API key); the human-readable `displayName` lives in settings and renaming it never changes the folder name.

### Media kinds (`settingsFile.ts: MediaTypeKind`)

- `images` — image files + schema-driven metadata; only allowed image extensions surface.
- `generic` — file-backed catalog like images but any extension; schema optional.
- `blob_store` — the single global `files/` dir itself; flat, browse-only, no linked/unlinked split.
- `json` — records only, no file attachments.

`usesImageRepoKind(kind)` (`paths.ts`) returns true for the three file-backed kinds; they all route through `createImageRepo` / `repo.ts`. `json` uses `jsonRepo.ts`. `isBrowseFirstFileKind` (`mediaKinds.ts`) is the client-safe check for generic/blob_store UI.

### Shared global blob store (critical design invariant)

**All file-backed kinds read/write binaries from ONE directory: `<root>/files/` (`getGlobalFilesDir()`).** Every blob is registered in a global **manifest** (`<root>/files/manifest.json`, `manifest.ts`) that gives it a stable, workspace-scoped **id** (UUID — the manifest key) and holds its current filename. A file-backed catalog row's primary key is `id` (same field json records use) and its value **is** that manifest id; the filename is **not** stored on the row — it's resolved from the manifest at read time. Unlike a json `id` (unique to one record), a file-backed `id` is the blob's identity, so the same `id` appears in every catalog referencing that blob — **overlap is intentional, not a bug.** Consequences (all expected):

- Deleting a blob from disk drops its manifest entry and strips rows keyed by that `file_id` from _every_ catalog (`removeCatalogReferencesToFileIdGlobally`).
- Renaming a file is **O(1)**: rename the blob on disk + update the one manifest entry (`renameFileById` → `manifest.renameFileId`). No cross-catalog fan-out — every `file_id` reference is unaffected. (The old `propagateFilenameRename` was removed.)
- Every list call **lazy-heals** the manifest against disk (`reconcile`): new files get a `file_id`, vanished blobs are flagged (not deleted); the response carries `healed: { added, missing }`.
- A non-image blob existing in `files/` will not appear in an `images` catalog — filtering by extension per-kind is by design.

For file-backed catalogs: a blob is **linked** if it has a row whose `id` is the blob's manifest id, **unlinked** if on disk (a manifest id) with no row and not excluded, **excluded** if its id is listed in `settings.excludedFiles`. Identity is the manifest id, so linking an unlinked file never changes its id. The legacy `unlinked:<name>` id scheme was removed. Migration is explicit-only (`npm run upgrade-data -- <root> --apply`); the app errors loudly on a file-backed row not in the current `id`-keyed shape.

### Reserved types

`files` (auto-created `blob_store`) and `globals` (auto-created `json` singleton) are in `RESERVED_TYPE_IDS` (`mediaTypes.ts`). They cannot be user-created, renamed, or deleted — enforced in both the storage layer and the API route guards. `ensureFilesGroupExists()` / `ensureGlobalsGroupExists()` create/heal them.

### Storage layer (`src/lib/storage/`)

- `paths.ts` — root + per-type path resolution, `usesImageRepoKind`, legacy `getAssetPaths()`.
- `repo.ts` — file-backed persistence: list/CRUD/schema/filters, `id`-keyed rows whose id is the blob's manifest id (names resolved via the manifest). `listImages` reconciles the manifest then branches on `isDiskOnlyList` (blob_store) vs catalog kinds and `allowAnyExtension` (generic).
- `manifest.ts` — global blob manifest (`files/manifest.json`): `file_id` registry with `mintFileId` / `renameFileId` / `removeFileId` / `reconcile` (lazy heal), atomic under a manifest lock taken before any catalog lock.
- `jsonRepo.ts` — `json`-kind record persistence.
- `settingsFile.ts` — read/write `settings.json` (both new and legacy layouts).
- `mediaTypes.ts` — type CRUD + ensured default groups.
- `lock.ts` — `withFileLock` coarse `.lock`-file mutex protecting JSON writes; **single-node only**, not distributed.
- `json.ts` — atomic JSON writes.

### Server / API

`src/lib/server/imageRepo.ts` validates `typeId` against `/^[a-zA-Z0-9_-]+$/` (path-traversal guard) and returns the right repo by kind. Routes live under `src/routes/api/media-types/[typeId]/...` (full index in FEATURES.md). A **legacy** single-folder layout is still supported via `/api/images/*`, `/api/schema`, `/api/config` (no `typeId` in path) backed by `getAssetPaths()`. Client fetch wrappers (type-scoped `*ForType` + legacy) are in `src/lib/api/client.ts`.

### Frontend

- Routes: `/` overview (`MediaTypeOverview.svelte`), `/media/[typeId]` editor page that switches editor pane by kind: `ImageEditorPane` (image/generic/blob_store), `JsonEditorPane` (json), `GlobalsEditorPane` (the `globals` singleton).
- Core (client+server safe, no Node imports): `src/lib/core/` — Zod DTOs/schema types (`types.ts`), `filters.ts`, `ids.ts`, `mediaKinds.ts`, `fieldKeys.ts` (reserved keys like `__field_kinds`).
- State: `src/lib/state/selection.svelte.ts` (runes) + `src/lib/stores/`.
- UI primitives under `src/lib/components/ui/` are shadcn-svelte (bits-ui) components via `components.json`; prefer composing these.

## Conventions

- **Svelte 5 only** (`.cursor/rules/svelte5.mdc`): use runes (`$state`, `$derived`, `$effect`, `$props`) — not legacy `export let` / reactive `$:`.
- **Document new functions** (`.cursor/rules/document.mdc`): the codebase uses rich JSDoc with `@param`, use-case, and a "Concerns / future improvements" section. Match that density.
- Field values: `url`-type fields are `{ display_name, url }` (`UrlValue`); legacy plain strings are normalized via `normalizeUrlValue`. Records use snake_case keys on disk; every record is keyed by `id` (for file-backed rows that id is the blob's manifest id, with the filename resolved from the manifest, not stored), `last_modified` is an ISO string. A `file`-type field value is a manifest id reference.
- Schema field types: `string | number | boolean | dropdown | list | url | file` (`FieldTypeSchema`).
