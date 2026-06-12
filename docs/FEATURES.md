# Feature registry (media-manager)

**Purpose:** Single map of product behavior, implementation locations, and known gaps.  
**Audience:** Humans and agents working in this repo.  
**Companion:** User-facing setup, data layout, and how to run the built app live in [`README.md`](../README.md). The deferred-work backlog lives in [`FUTURE_CHANGES.md`](FUTURE_CHANGES.md) (the old `tasks.md` has been consolidated there).

**Last reviewed:** 2026-06-07

---

## How to use this document

1. Before changing behavior, find the relevant **feature row** and **primary files**.
2. After shipping a change, update this file in the **same PR or commit** (feature table, API index, media-kind notes, or residual notes).
3. If you add routes, API handlers, or major UI flows, add or extend rows here—do not rely only on README.

---

## Media kinds and storage

| Kind | Meaning | Default data file | Files on disk | Repository implementation | UI editor |
|------|---------|-------------------|---------------|----------------------------|-----------|
| `images` | Catalog of image files + schema-driven metadata | `image-data.json` | Global `files/` store (shared) | `createImageRepo(typeId)` → [`repo.ts`](../src/lib/storage/repo.ts) | [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) |
| `json` | Records only, no file attachments | `data.json` | — | `createJsonRepoForType(typeId)` → [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts) | [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte) (except `globals`) |
| `generic` | File-backed catalog; optional empty schema; full `linked`/`unlinked`/`excluded` split like `images` but allows any file extension | `data.json` with `{ images: [] }` when created via API | Global `files/` store (shared) | `createImageRepo(typeId)` via [`usesImageRepoKind`](../src/lib/storage/paths.ts) in [`createMediaTypeRepo`](../src/lib/storage/repo.ts) | Same as `images`: [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) ([`media/[typeId]/+page.svelte`](../src/routes/media/[typeId]/+page.svelte)) |
| `blob_store` | The single global `files/` directory; **flat, browse-only** listing of every blob (no linked/unlinked/excluded split); no schema editing | `image-data.json` | Global `files/` store (is this dir) | `createImageRepo(typeId)` via [`usesImageRepoKind`](../src/lib/storage/paths.ts) | Same as `images`: [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) |

**Shared global blob store + manifest (by design):** All file-backed kinds (`images`, `generic`, `blob_store`) store and read their binaries from a single global `files/` directory under `MEDIA_MANAGER_ROOT` ([`getGlobalFilesDir()`](../src/lib/storage/paths.ts)). Every blob is registered in a global **manifest** ([`files/manifest.json`](../src/lib/storage/manifest.ts)) that gives it a stable, workspace-scoped **id** (a UUID — the manifest key) and holds its current filename. A file-backed catalog row's primary key is `id` (the same key `json` records use), and its value **is** that manifest id; the filename is **not** stored on the row — it is resolved from the manifest at read time (no denormalized copy). Unlike a json record's `id` (unique to one record), a file-backed `id` is the **blob's** identity, so the *same* `id` legitimately appears in every catalog that references that blob — **overlap is intentional, not a bug.** Consequences (all expected):
- **Delete from disk** removes the blob, drops its manifest entry, and strips rows keyed by that `file_id` from **every** catalog ([`removeCatalogReferencesToFileIdGlobally`](../src/lib/storage/repo.ts)); the UI warns which groups are affected and offers "exclude from this group" instead.
- **Rename** is an **O(1)** operation: it renames the blob on disk and updates the single manifest entry ([`renameFileById`](../src/lib/storage/repo.ts) → [`manifest.renameFileId`](../src/lib/storage/manifest.ts)). There is **no cross-catalog fan-out** — every reference (by id) is unaffected. (The old filename-rewrite `propagateFilenameRename` was removed.)
- **Lazy heal:** every list call reconciles the manifest against disk ([`reconcile`](../src/lib/storage/manifest.ts)) — new files on disk are minted a `file_id`, and entries whose blob vanished are flagged (not deleted). The response carries `healed: { added, missing }` and the sidebar shows a toast when non-zero.
- **Per-catalog visibility is intentionally filtered by kind:** `images` catalogs only surface files with an allowed image extension; `generic`/`blob_store` surface any basename. So a non-image blob existing in `files/` will not appear in an `images` catalog — this is expected, not a missing file.
- **Single point of failure / locking:** the manifest is load-bearing for every file-backed catalog; its mutations are atomic under one `.lock`. When an op needs both the manifest lock and a catalog lock, it takes the **manifest lock first**.

**Filenames:** `generic` / `blob_store` use [`assertSafeBasename`](../src/lib/storage/filenames.ts) in [`repo.ts`](../src/lib/storage/repo.ts) (`assertRecordFilename`) so non-image extensions work. `images` still require an allowed image extension.

**Root discovery:** `MEDIA_MANAGER_ROOT` → [`getRootDir()`](../src/lib/storage/paths.ts). Each immediate subfolder with a valid [`settings.json`](../src/lib/storage/settingsFile.ts) is a media type (`typeId` = folder name).

**Legacy single-folder layout:** Still supported via [`getAssetPaths()`](../src/lib/storage/paths.ts) and `/api/images/*` + `/api/schema` (no `typeId` in path).

**Auto-created groups:** [`ensureFilesGroupExists()`](../src/lib/storage/mediaTypes.ts) creates `files/` with `kind: blob_store` (global blob directory). [`ensureGlobalsGroupExists()`](../src/lib/storage/mediaTypes.ts) creates/heals `globals/` as `kind: json` with exactly one singleton record.

**Reserved type ids:** `files` and `globals` ([`RESERVED_TYPE_IDS`](../src/lib/storage/mediaTypes.ts)) are protected end-to-end: they cannot be created by users (`createMediaType` throws), renamed, or deleted (`deleteMediaType` throws + API route guards). This is enforced in both the storage layer and the API handlers.

**Linked / unlinked / excluded (file-backed catalogs):** For `images` and `generic`, a blob is **linked** if it has a catalog row whose `id` is the blob's manifest id (a row existing = linked, regardless of whether metadata fields are filled), **unlinked** if it is on disk (a manifest id) with no row in this catalog and not excluded, and **excluded** if its id is listed in the type's `settings.excludedFiles`. Because identity is the manifest id, **linking an unlinked file never changes its id**, and exclusion follows the blob, not its name. `images` only surfaces allowed image extensions; `generic` surfaces any extension. `blob_store` does not use this split (flat browse-only). A `file`-typed schema field stores a `file_id` reference.

---

## Feature catalog

Status legend: **stable** (works end-to-end for the happy path) · **partial** (implemented but incomplete or inconsistent) · **experimental** (may change)

| Feature | Expected behavior | Status | Primary files | API / notes |
|--------|-------------------|--------|---------------|-------------|
| Home overview | List media types; create/rename/delete; open type | stable | [`MediaTypeOverview.svelte`](../src/lib/components/MediaTypeOverview.svelte) | `GET/POST /api/media-types`, `PATCH/DELETE /api/media-types/[typeId]` |
| Type-scoped image UI | Sidebar + editor: linked/unlinked/missing, filters, grid, upload | stable | [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte), [`AppSidebar.svelte`](../src/lib/components/AppSidebar.svelte), [`ImageViewGrid.svelte`](../src/lib/components/ImageViewGrid.svelte) | [`client.ts`](../src/lib/api/client.ts) `api*` ForType helpers |
| Type-scoped JSON UI | Record list/grid, schema-driven fields, create/delete record | stable | [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte), [`JsonRecordGrid.svelte`](../src/lib/components/JsonRecordGrid.svelte) | Same client; `DELETE` on record unlinks vs deletes per server kind |
| Selection + view mode | Selected record, grid vs form, keyboard nav | stable | [`selection.svelte.ts`](../src/lib/state/selection.svelte.ts) | — |
| Schema editor | Add/rename/delete fields; protected keys | stable | [`SchemaEditorButton.svelte`](../src/lib/components/SchemaEditorButton.svelte) | `/api/media-types/[typeId]/schema`, legacy `/api/schema` |
| String field editing | Every `string`-field value renders as an autogrow `<textarea>` (starts one row, grows to fit) in all three editor panes; **Enter** blurs + saves, **Shift+Enter** inserts a newline. No per-field toggle/`long` flag — all strings are multiline. | stable | [`autogrow.ts`](../src/lib/actions/autogrow.ts), [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte), [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte), [`GlobalsEditorPane.svelte`](../src/lib/components/GlobalsEditorPane.svelte) | — |
| Filters | Multi-clause filters + legacy query/field/empty | stable | [`filters.ts`](../src/lib/core/filters.ts), repos | `filters` query on list endpoints |
| Upload + conflicts | Upload; optional overwrite / auto-rename; HEIC→JPEG for **images** (not generic) | stable | [`AppSidebar.svelte`](../src/lib/components/AppSidebar.svelte), [`upload/+server.ts`](../src/routes/api/media-types/[typeId]/upload/+server.ts) | `POST .../upload`, `POST .../upload/check` |
| Link file to catalog | Create a row for an existing blob by `file_id` (file-backed kinds); the id is unchanged on link | stable | Sidebar / editor flows | `POST .../records/link` (body `{ file_id }`) |
| Unlink vs delete | Unlink removes JSON record, keeps file; delete removes file (+ record if linked) | stable | [`DeleteButton.svelte`](../src/lib/components/DeleteButton.svelte), editors | `DELETE .../records/by-id/[id]`, `DELETE .../records/by-id/[id]/file` |
| Rename file | O(1): renames the blob on disk + updates the single manifest entry; no cross-catalog fan-out (every `file_id` reference is unaffected) | stable | [`MetadataButton.svelte`](../src/lib/components/MetadataButton.svelte), [`ImageViewGrid.svelte`](../src/lib/components/ImageViewGrid.svelte), [`manifest.ts`](../src/lib/storage/manifest.ts) | `POST .../records/by-id/[id]/rename` |
| Excluded files | Hide blobs (by `file_id`) from the unlinked list; clean stale entries | stable | UI in sidebar/grid as wired | `POST .../excluded` (body `{ file_ids, action }`), `POST .../excluded/clean` (body `{ file_ids }`) |
| File metadata | Read / strip EXIF (all or GPS) | stable | [`MetadataButton.svelte`](../src/lib/components/MetadataButton.svelte) | `.../file-metadata/by-id/[id]`, `.../strip` |
| Image compare | Side-by-side compare (legacy/global) | stable | routes under `/api/images/compare` | [`images/compare/+server.ts`](../src/routes/api/images/compare/+server.ts) |
| Settings UI | Grid size, auto-advance, theme appearance | stable | [`SettingsButton.svelte`](../src/lib/components/SettingsButton.svelte), [`AppearanceSettings.svelte`](../src/lib/components/AppearanceSettings.svelte) | `/api/config`, `/api/config/settings`, type `.../settings` |
| Stats popup | Record counts + last updated | stable | Overview | `GET .../stats` |
| File picker (system) | Native folder/file dialog where used | stable | [`FilePicker.svelte`](../src/lib/components/FilePicker.svelte) | — |
| Generic catalog | File-backed catalog over the global `files/` store; any extension; linked/unlinked/excluded split like images | stable | [`paths.ts`](../src/lib/storage/paths.ts), [`repo.ts`](../src/lib/storage/repo.ts) (`listImages` main branch, `allowAnyExtension`), [`usesImageRepoKind`](../src/lib/storage/paths.ts) | Same file-backed routes as `images` |
| Blob store (`files`) | Single global `files/` directory; flat browse-only view of every blob (manifest ids on disk); image blobs render thumbnails in the grid (non-image blobs show a file-type chip); overlap with catalogs is expected | stable | [`repo.ts`](../src/lib/storage/repo.ts) (`listImages` `isDiskOnlyList` branch, runs `reconcile`), [`getGlobalFilesDir()`](../src/lib/storage/paths.ts), [`manifest.ts`](../src/lib/storage/manifest.ts) | Delete affects all catalogs; rename is manifest-only; see "Shared global blob store + manifest" above |
| Globals field types | Free-form field type (string/number/boolean/dropdown/list/url) persists across reloads via reserved `__field_kinds` hint | stable | [`GlobalsEditorPane.svelte`](../src/lib/components/GlobalsEditorPane.svelte) | Stored in the singleton record as a JSON-encoded string; hidden from the field list |
| Globals singleton | Exactly one app-wide JSON object; free-form fields; no schema editing; protected from rename/delete | stable | [`mediaTypes.ts`](../src/lib/storage/mediaTypes.ts), [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts), [`GlobalsEditorPane.svelte`](../src/lib/components/GlobalsEditorPane.svelte) | `GET/POST /api/media-types/globals/record`, protected behavior in `/api/media-types/[typeId]` + `/schema` |

---

## HTTP API index (quick reference)

### Multi-type (`/api/media-types/...`)

| Path pattern | Role |
|--------------|------|
| `/api/media-types` | List + create (`kind`: `images` \| `json` \| `generic`) |
| `/api/media-types/[typeId]` | Get / patch display name / delete type |
| `/api/media-types/[typeId]/stats` | Counts + mtime |
| `/api/media-types/[typeId]/schema` | Schema CRUD: `GET` read, `POST` add field, `PATCH` update field, `DELETE` remove field, `PUT` replace whole schema (import / clone) |
| `/api/media-types/[typeId]/settings` | Read/write type settings |
| `/api/media-types/[typeId]/records/list` | List: ImageListResponse (file-backed kinds; item `id` is the blob's manifest id, includes lazy-heal `healed: { added, missing }`) vs JsonListResponse |
| `/api/media-types/[typeId]/records/field-values` | Distinct values for autocomplete |
| `/api/media-types/[typeId]/records` | POST create (**json** kind only) |
| `/api/media-types/[typeId]/records/link` | Link an existing blob by `file_id` (file-backed kinds); body `{ file_id }` |
| `/api/media-types/[typeId]/records/by-id/[id]` | GET record, POST patch, DELETE unlink/delete record |
| `/api/media-types/[typeId]/records/bulk-update` | POST: apply one patch to many record ids (`bulkUpdatePropertiesByIds`) |
| `/api/media-types/[typeId]/records/bulk-delete` | POST: unlink (file-backed) or delete (json) many record ids |
| `/api/media-types/[typeId]/records/bulk-delete-disk` | POST: delete many backing files from disk (strips refs across catalogs) |
| `/api/media-types/[typeId]/records/repair` | POST `{ dryRun }`: validate records vs schema; fill missing fields when not dry run |
| `/api/media-types/[typeId]/records/by-id/[id]/file` | GET file bytes (`[id]` = `file_id`), DELETE blob from disk (drops manifest entry + strips rows across catalogs) |
| `/api/media-types/[typeId]/records/by-id/[id]/rename` | Rename blob on disk + manifest entry (O(1), no fan-out) |
| `/api/media-types/[typeId]/upload` | Multipart upload; registers the blob in the manifest and returns its `file_id` (as `id`) |
| `/api/media-types/[typeId]/upload/check` | Conflict check |
| `/api/media-types/[typeId]/file-metadata/by-id/[id]` | Metadata read |
| `/api/media-types/[typeId]/file-metadata/by-id/[id]/strip` | Strip metadata |
| `/api/media-types/[typeId]/excluded` | Exclude / unexclude blobs by `file_id`; body `{ file_ids, action }` |
| `/api/media-types/[typeId]/excluded/clean` | Remove stale excluded entries; body `{ file_ids }` |
| `/api/media-types/globals/record` | Read/update singleton globals object (free-form fields, `null` removes key) |

Handler files live under [`src/routes/api/media-types/`](../src/routes/api/media-types/).

### Legacy global (`/api/images/...`, `/api/schema`, `/api/config`)

Used when data lives in the single-folder layout (no `typeId`). See [`src/routes/api/images/`](../src/routes/api/images/) and [`src/routes/api/schema/+server.ts`](../src/routes/api/schema/+server.ts).

### Client wrapper

Type-scoped and legacy fetch helpers: [`src/lib/api/client.ts`](../src/lib/api/client.ts).

---

## Cross-cutting modules

| Area | Responsibility | File(s) |
|------|----------------|---------|
| Path resolution | Root, per-type paths, legacy paths, `usesImageRepoKind` | [`paths.ts`](../src/lib/storage/paths.ts) |
| Image + file-backed persistence | List, CRUD, schema, filters, `id`-keyed rows (value = blob's manifest id), manifest-resolved names | [`repo.ts`](../src/lib/storage/repo.ts) |
| Global blob manifest | `file_id` registry (`files/manifest.json`): mint, rename, remove, reconcile (lazy heal) | [`manifest.ts`](../src/lib/storage/manifest.ts) |
| JSON-record persistence | List, CRUD, schema for `json` kind | [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts) |
| Settings on disk | Read/write `settings.json` (both layouts) | [`settingsFile.ts`](../src/lib/storage/settingsFile.ts) |
| Type CRUD | Create/delete/list, ensured defaults | [`mediaTypes.ts`](../src/lib/storage/mediaTypes.ts) |
| Server repo accessor | Validates `typeId`, returns repo | [`imageRepo.ts`](../src/lib/server/imageRepo.ts) |
| Types + Zod | Shared DTOs | [`types.ts`](../src/lib/core/types.ts) |
| IDs | Record id + blob `file_id` (both UUID) | [`ids.ts`](../src/lib/core/ids.ts) |
| CLI entry | Run built app with `MEDIA_MANAGER_ROOT` | [`bin/media-manager.js`](../bin/media-manager.js) |

---

## Residual notes

- **README** is the canonical place for install, **build + run** (`npm run build`, `node build`, `media-manager <root>`), and data layout examples.
- **`docs/FUTURE_CHANGES.md`** is the deferred-work backlog (non-committing ideas; do not treat it as the shipped feature set). `tasks.md` has been consolidated into it and is now just a pointer.
- **Data upgrade tool:** [`scripts/upgrade-data.mjs`](../scripts/upgrade-data.mjs) (`npm run upgrade-data -- <root>` or `... -- <root> --apply`) scans a data root and reports/applies the expected upgrades: `files/` → `blob_store`, `globals/` singleton heal (canonical UUID), relocating legacy per-type blobs into the shared global `files/` store (basenames preserved; conflicts reported, never clobbered), and **stable file ids** (build `files/manifest.json`, rekey file-backed rows to `{ id: <manifest id>, … }` — handling both the legacy `{ id, file_name }` and interim `{ file_id }` layouts — and migrate `file`-field values and `excludedFiles` to ids). Idempotent and re-runnable; dry-run by default. The app **errors loudly** on a file-backed row not in the current `id`-keyed shape (run this tool) — there is no silent runtime auto-migration.

---

## Roadmap / non-authoritative ideas

See [`FUTURE_CHANGES.md`](FUTURE_CHANGES.md). Items there are **not** commitments; this file describes what the codebase is meant to do today.
