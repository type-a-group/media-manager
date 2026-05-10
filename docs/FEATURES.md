# Feature registry (media-manager)

**Purpose:** Single map of product behavior, implementation locations, and known gaps.  
**Audience:** Humans and agents working in this repo.  
**Companion:** User-facing setup, data layout, and how to run the built app live in [`README.md`](../README.md). Informal backlog / ideas live in [`tasks.md`](../tasks.md).

**Last reviewed:** 2026-05-08

---

## How to use this document

1. Before changing behavior, find the relevant **feature row** and **primary files**.
2. After shipping a change, update this file in the **same PR or commit** (feature table, API index, media-kind notes, or residual notes).
3. If you add routes, API handlers, or major UI flows, add or extend rows here—do not rely only on README.

---

## Media kinds and storage

| Kind | Meaning | Default data file | Files on disk | Repository implementation | UI editor |
|------|---------|-------------------|---------------|----------------------------|-----------|
| `images` | Catalog of image files + schema-driven metadata | `image-data.json` (`{ images: [] }`) | Global `files/` dir | `createImageRepo(typeId)` → [`repo.ts`](../src/lib/storage/repo.ts) | [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) |
| `json` | Records only, no file attachments | `data.json` (`{ records: [] }`) | — | `createJsonRepoForType(typeId)` → [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts) | [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte) (except `globals`) |
| `generic` | General file catalog; optional schema; list shows both linked & unlinked files | `data.json` (`{ files: [] }`) | Global `files/` dir | `createImageRepo(typeId)` via [`usesImageRepoKind`](../src/lib/storage/paths.ts) | Same as `images`: [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) |
| `blob_store` | Auto-created; browse-only view of global `files/` directory | `image-data.json` | Global `files/` dir | `createImageRepo(typeId)` | Same as `images` (browse-first mode) |

**Schema field types:** `string`, `number`, `boolean`, `dropdown`, `list`, `url`, `file`.

**Filenames:** `generic` and `blob_store` use [`assertSafeBasename`](../src/lib/storage/filenames.ts) so non-image extensions work. `images` still require an allowed image extension.

**Root discovery:** `MEDIA_MANAGER_ROOT` → [`getRootDir()`](../src/lib/storage/paths.ts). Each immediate subfolder with a valid [`settings.json`](../src/lib/storage/settingsFile.ts) is a media type (`typeId` = folder name). All file-backed types share a single global `files/` directory at the root level.

**Auto-created groups:** [`ensureFilesGroupExists()`](../src/lib/storage/mediaTypes.ts) creates `files/` with `kind: blob_store` (global blob directory). [`ensureGlobalsGroupExists()`](../src/lib/storage/mediaTypes.ts) creates/heals `globals/` as `kind: json` with exactly one singleton record.

---

## Feature catalog

Status legend: **stable** (works end-to-end for the happy path) · **partial** (implemented but incomplete or inconsistent) · **experimental** (may change)

| Feature | Expected behavior | Status | Primary files | API / notes |
|--------|-------------------|--------|---------------|-------------|
| Home overview | List media types; create/rename/delete; open type | stable | [`MediaTypeOverview.svelte`](../src/lib/components/MediaTypeOverview.svelte) | `GET/POST /api/media-types`, `PATCH/DELETE /api/media-types/[typeId]` |
| Type-scoped image UI | Sidebar + editor: linked/unlinked/missing, filters, grid, upload | stable | [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte), [`AppSidebar.svelte`](../src/lib/components/AppSidebar.svelte), [`ImageViewGrid.svelte`](../src/lib/components/ImageViewGrid.svelte) | [`client.ts`](../src/lib/api/client.ts) `api*` ForType helpers |
| Type-scoped JSON UI | Record list/grid, schema-driven fields, create/delete record | stable | [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte), [`JsonRecordGrid.svelte`](../src/lib/components/JsonRecordGrid.svelte) | Same client; `DELETE` on record unlinks vs deletes per server kind |
| Selection + view mode | Selected record, grid vs form, keyboard nav | stable | [`selection.svelte.ts`](../src/lib/state/selection.svelte.ts) | — |
| Schema editor | Add/rename/delete fields; protected keys; supports `file` type | stable | [`SchemaEditorButton.svelte`](../src/lib/components/SchemaEditorButton.svelte) | `/api/media-types/[typeId]/schema` |
| Filters | Multi-clause filters (all field types including `file`) | stable | [`filters.ts`](../src/lib/core/filters.ts), repos | `filters` query on list endpoints |
| Upload + conflicts | Upload; optional overwrite / auto-rename; HEIC→JPEG for **images** (not generic) | stable | [`AppSidebar.svelte`](../src/lib/components/AppSidebar.svelte), [`upload/+server.ts`](../src/routes/api/media-types/[typeId]/upload/+server.ts) | `POST .../upload`, `POST .../upload/check` |
| Link file to catalog | Create record for existing filename (file-backed kinds) | stable | Sidebar / editor flows | `POST .../records/link` |
| Unlink vs delete | Unlink removes JSON record, keeps file; delete removes file (+ record if linked) | stable | [`DeleteButton.svelte`](../src/lib/components/DeleteButton.svelte), editors | `DELETE .../records/by-id/[id]`, `DELETE .../records/by-id/[id]/file` |
| Rename file | Disk + JSON; cross-type reference updates in repo | stable | [`MetadataButton.svelte`](../src/lib/components/MetadataButton.svelte), [`ImageViewGrid.svelte`](../src/lib/components/ImageViewGrid.svelte) | `POST .../records/by-id/[id]/rename` |
| Excluded files | Hide files from unlinked list; clean list | stable | UI in sidebar/grid as wired | `POST .../excluded`, `POST .../excluded/clean` |
| File metadata | Read / strip EXIF (all or GPS) | stable | [`MetadataButton.svelte`](../src/lib/components/MetadataButton.svelte) | `.../file-metadata/by-id/[id]`, `.../strip` |
| Settings UI | Grid size, auto-advance, theme appearance | stable | [`SettingsButton.svelte`](../src/lib/components/SettingsButton.svelte), [`AppearanceSettings.svelte`](../src/lib/components/AppearanceSettings.svelte) | type `.../settings` |
| Stats popup | Record counts + last updated | stable | Overview | `GET .../stats` |
| File picker (system) | Native folder/file dialog where used | stable | [`FilePicker.svelte`](../src/lib/components/FilePicker.svelte) | — |
| Generic / “Files” group | File-backed folder; optional schema; browse/link like images | stable | [`paths.ts`](../src/lib/storage/paths.ts), [`repo.ts`](../src/lib/storage/repo.ts) (`listImages` generic branch), [`usesImageRepoKind`](../src/lib/storage/paths.ts) | Same file-backed routes as `images` |
| Globals singleton | Exactly one app-wide JSON object; free-form fields; no schema editing; protected from rename/delete | stable | [`mediaTypes.ts`](../src/lib/storage/mediaTypes.ts), [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts), [`GlobalsEditorPane.svelte`](../src/lib/components/GlobalsEditorPane.svelte) | `GET/POST /api/media-types/globals/record`, protected behavior in `/api/media-types/[typeId]` + `/schema` |

---

## HTTP API index (quick reference)

### Multi-type (`/api/media-types/...`)

| Path pattern | Role |
|--------------|------|
| `/api/media-types` | List + create (`kind`: `images` \| `json` \| `generic`) |
| `/api/media-types/[typeId]` | Get / patch display name / delete type |
| `/api/media-types/[typeId]/stats` | Counts + mtime |
| `/api/media-types/[typeId]/schema` | Schema CRUD |
| `/api/media-types/[typeId]/settings` | Read/write type settings |
| `/api/media-types/[typeId]/records/list` | List: ImageListResponse (file-backed kinds) vs JsonListResponse |
| `/api/media-types/[typeId]/records/field-values` | Distinct values for autocomplete |
| `/api/media-types/[typeId]/records` | POST create (**json** kind only) |
| `/api/media-types/[typeId]/records/link` | Link existing file (file-backed kinds) |
| `/api/media-types/[typeId]/records/by-id/[id]` | GET record, POST patch, DELETE unlink/delete record |
| `/api/media-types/[typeId]/records/by-id/[id]/file` | GET file bytes, DELETE file from disk |
| `/api/media-types/[typeId]/records/by-id/[id]/rename` | Rename on disk + data |
| `/api/media-types/[typeId]/upload` | Multipart upload |
| `/api/media-types/[typeId]/upload/check` | Conflict check |
| `/api/media-types/[typeId]/file-metadata/by-id/[id]` | Metadata read |
| `/api/media-types/[typeId]/file-metadata/by-id/[id]/strip` | Strip metadata |
| `/api/media-types/[typeId]/excluded` | Exclude / unexclude filenames |
| `/api/media-types/[typeId]/excluded/clean` | Remove entries from excluded list |
| `/api/media-types/globals/record` | Read/update singleton globals object (free-form fields, `null` removes key) |


Handler files live under [`src/routes/api/media-types/`](../src/routes/api/media-types/).

### Client wrapper

Type-scoped fetch helpers: [`src/lib/api/client.ts`](../src/lib/api/client.ts).

---

## Cross-cutting modules

| Area | Responsibility | File(s) |
|------|----------------|---------|
| Path resolution | Root, per-type paths, `usesImageRepoKind` | [`paths.ts`](../src/lib/storage/paths.ts) |
| Image + file-backed persistence | List, CRUD, schema, filters, rename propagation | [`repo.ts`](../src/lib/storage/repo.ts) |
| JSON-record persistence | List, CRUD, schema for `json` kind | [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts) |
| Settings on disk | Read/write `settings.json` (per-type only) | [`settingsFile.ts`](../src/lib/storage/settingsFile.ts) |
| Type CRUD | Create/delete/list, ensured defaults | [`mediaTypes.ts`](../src/lib/storage/mediaTypes.ts) |
| Server repo accessor | Validates `typeId`, returns repo | [`imageRepo.ts`](../src/lib/server/imageRepo.ts) |
| Types + Zod | Shared DTOs | [`types.ts`](../src/lib/core/types.ts) |
| IDs | Image / record ids | [`ids.ts`](../src/lib/core/ids.ts) |
| CLI entry | Run built app with `MEDIA_MANAGER_ROOT` | [`bin/media-manager.js`](../bin/media-manager.js) |

---

## Residual notes

- **README** is the canonical place for install, **build + run** (`npm run build`, `node build`, `media-manager <root>`), and data layout examples.
- **`tasks.md`** holds non-committing ideas; do not treat it as the shipped feature set.

---

## Roadmap / non-authoritative ideas

See [`FUTURE_CHANGES.md`](./FUTURE_CHANGES.md) for planned improvements identified during the codebase audit (file picker UI, missing-file indicators, etc.). See [`tasks.md`](../tasks.md) for other ideas. Items there are **not** commitments; this file describes what the codebase is meant to do today.
