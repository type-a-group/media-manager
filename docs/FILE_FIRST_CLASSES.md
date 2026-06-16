# File-First Classes — Design

**Status:** Design agreed, **not yet implemented**. This document is the authoritative spec for the redesign. It is written to be read cold (no prior chat context) before any implementation session.

**Related backlog:** `docs/FUTURE_CHANGES.md` Items **18** (records reorg), **19** (per-class triage / `excludedFiles` successor), **20** (file-based routing), and complements **8** (verbose grid display) and **10** (empty/missing-field filter). Read `CLAUDE.md` first for the current architecture this replaces.

---

## 1. Problem

Today, to track e.g. "gallery images" and "travel images" with **different schemas**, you create two `images` media types (catalogs). A single file often belongs to both, but not all files belong to both. The current model is **catalog-first and opt-out**:

- Each catalog view tries to show every blob in the global `files/` store, so a file is `linked` / `unlinked` / `excluded` per catalog.
- A brand-new catalog starts with **every existing file showing as `unlinked` noise**; cleaning it up means `exclude`-ing the ones that don't belong — manual per-file work against the _entire_ library.
- N catalogs ⇒ you visit N places to fully classify one file, and the `excludedFiles` lists grow.

This scales badly precisely as you add more groups — the stated primary pain.

## 2. Core reframe

**Files are the primary entity; classification is an opt-in layer on top.** This is already how the data lives — the global blob store + manifest (`files/manifest.json`) makes files primary; a "catalog/group" is really just a per-class metadata table keyed by `file_id`.

So the redesign is mostly a **UI inversion + an opt-in flip**, plus a storage reorganization that makes the model physical:

- A **class** = a schema + **opt-in** per-file metadata (what a catalog is today), for **any** blob type (image, video, PDF, …) — extension no longer gates membership.
- Membership is **opt-in**: a file is simply _not_ a member of a class until you add it. There is **no exclude** and no `unlinked` state. Adding a new class costs **zero** work against existing files.
- **Unclassified** = a file with zero class memberships (derived).
- The reserved `files` blob*store becomes the **home/hub** ("All Files"); classes live \_inside* it, not as top-level types.

## 3. Decisions (quick reference)

| #                   | Decision                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation          | **Option B**: `Files` is the hub/home; classes are a concept _inside_ it, not top-level overview tiles.                                              |
| Scope               | Any file type (images, video, PDF, …). Per-kind extension filtering for membership is **removed**. `json` records are separate (deferred → Item 18). |
| Membership          | **Opt-in**, multi-class (tag-like). Overlap is normal.                                                                                               |
| Metadata model      | **Separate metadata per class** — a file accumulates one section per class it belongs to (schemas mostly disjoint).                                  |
| `excludedFiles`     | **Removed.** Triage successor deferred → Item 19.                                                                                                    |
| Reserved types      | `files`/`globals` ids dissolve (`files` = hub, `globals` → records side). `RESERVED_TYPE_IDS` empties on the media side. No reserved classes.        |
| Class identity      | id = filename stem, **fixed at creation**; `displayName` in class `config` is freely renamable.                                                      |
| Class file          | **One JSON file per class**, schema embedded: `{ schema, config, records }`. Source of truth.                                                        |
| Empty-schema class  | **Allowed** = a pure tag/label (distinct from a _view_).                                                                                             |
| Manifest            | Moved to `media/manifest.json`. Carries a **derived** `classes[]` membership index per blob; class files win on conflict.                            |
| Reconcile           | **Option C**: incremental update on write + mtime-gated full resync from class files on load; blob-vs-disk heal still runs every list.               |
| All Files filter    | Searchable class bar, **OR by default with AND/OR toggle**. `Unclassified` is the lone built-in pseudo-filter.                                       |
| One class selected  | Grid **becomes that class's full catalog view** (group-by, display field, its columns, empty-field filter).                                          |
| Bulk + Add to class | Creates **empty memberships** (fields filled later inline).                                                                                          |
| Missing files       | **Global app-wide warning** (not a filter), drill-down filename → impacted records, with Clear / re-pick.                                            |
| Per-file editor     | Stays the **current in-page editor pane** (no new route). File-based routing deferred → Item 20.                                                     |
| Intrinsic info      | Size/dimensions/type/EXIF stay under the **existing info bubble**, separate from class sections.                                                     |

## 4. On-disk layout

```
<root>/
├─ media/
│  ├─ manifest.json     # blob registry + derived membership index
│  ├─ files/            # pure blob dir, any type
│  ├─ classes/
│  │   ├─ gallery.json  # { schema, config, records }  — SOURCE OF TRUTH
│  │   └─ travel.json
│  └─ settings.json     # saved views/filters, class ordering/pinning, media-wide prefs
└─ records/             # json-kind — DEFERRED (Item 18); today's json types stay as-is until then
```

### 4.1 `media/manifest.json`

The manifest is the blob registry and a **derived cache** of membership. Class files are authoritative; on drift the manifest heals toward them.

```jsonc
{
	"files": {
		"<file_id>": {
			"file_name": "photo_04.jpg", // current name; resolved at read time (not stored on rows)
			"classes": ["gallery", "portfolio"], // DERIVED index of class ids this blob is a member of
			"missing": false, // true when the blob vanished from disk (flagged, not deleted)
			"size": 123456,
			"created_at": "2026-01-01T00:00:00.000Z"
			// "hash" slot may be added later (dedupe) — see Item 6 follow-ups
		}
	}
}
```

`classes[]` is a denormalized convenience so the All Files grid can render every thumbnail + its chips + the Unclassified filter from **one read**, without loading any class file until you open a file's metadata. It is rebuilt from class files when drift is detected (§6).

### 4.2 `media/classes/<id>.json`

```jsonc
{
	"schema": [
		/* FieldTypeSchema[]: string|number|boolean|dropdown|list|url|file */
	],
	"config": {
		"displayName": "Gallery", // renamable; id (filename stem) is fixed
		"gridGroupByField": "album", // per-class grid prefs (optional)
		"displayField": "caption"
		// per-class settings live here, NOT in media/settings.json
	},
	"records": {
		"<file_id>": {
			// key IS the blob's manifest id (membership)
			"id": "<file_id>",
			"caption": "Santorini sunset",
			"album": "Greece 2024",
			"last_modified": "2026-01-01T00:00:00.000Z"
			// a `file`-type field value is itself a manifest id reference to another blob
		}
	}
}
```

A class with `schema: []` is a valid **pure-tag class** (membership with no metadata).

### 4.3 `media/settings.json`

Media-wide, cross-cutting state only:

- **Saved views/filters** (derived queries; own no data — see §5).
- Class ordering / pinning / favorites for the sidebar.
- Global prefs (e.g. default grid size).

Per-class settings do **not** go here — they live in each class file's `config`.

## 5. Conceptual model

- **Blob** — a file in `media/files/`, identified by a stable manifest `file_id` (UUID). Identity is the id, not the filename; rename is an O(1) manifest update.
- **Class** — a schema + opt-in per-blob metadata (`media/classes/<id>.json`). A blob is a **member** iff the class file has a record keyed by its id. Membership is binary: **member / not-member** (no linked/unlinked/excluded).
- **Unclassified** — a blob whose `classes[]` is empty.
- **View** — a _named, saved filter_ over blobs + class metadata (e.g. "travel from 2023", "videos with no caption"). Owns **no** data; deleting it loses nothing. Lives in `media/settings.json`. Distinct from a pure-tag class (which you assign and which owns membership). Views are not required for v1 but the model leaves room for them.
- **Missing** — a record (a class member row, or any `file`-type field value) that references a `file_id` whose blob is absent from disk. In-app delete strips memberships globally, so the durable case is a **`file`-field reference** to a deleted blob (Item 6 follow-up gap); external deletion of a blob is the other (edge) case. Surfaced as a global warning (§7.4), using the manifest's last-known `file_name`.

## 6. Reconcile & sync (Option C)

Class files are the source of truth; `manifest.classes[]` is a derived cache. Lock ordering is unchanged: **manifest lock taken before any catalog/class lock** (`manifest.ts` / `lock.ts`).

1. **On in-app membership write** (add/remove a file to/from a class): update the class file **and** the affected blobs' `manifest.classes[]` atomically. Steady state stays fresh and cheap.
2. **On load/list — mtime-gated resync:** if **any** class file's mtime is newer than the manifest's, rebuild `classes[]` from the class files (catches external/hand edits). Otherwise trust the index.
3. **Blob-vs-disk heal** runs every list as today: new blobs in `media/files/` get a manifest entry; vanished blobs are flagged `missing: true` (not deleted). Response carries `healed: { added, missing }`.

Deleting a class: remove `media/classes/<id>.json` and strip that id from every `manifest.classes[]`; **blobs are untouched** (a blob only in that class becomes unclassified). Guarded/confirmed action.

Deleting a blob from disk: drop its manifest entry and strip its member rows from **every** class file (global fan-out, as today via `removeCatalogReferencesToFileIdGlobally`). Rare, explicitly confirmed. (`file`-field references to it in _other_ records are the missing-file case — Item 6 follow-up.)

## 7. UX

### 7.1 All Files view (the home)

Manifest-driven grid; default (no filter) = the whole library. This view _is_ the Files hub home.

```
┌──────────────────────────────────────────────────────────────────┐
│ Files                                   [ search filenames…  🔍 ]  │
├───────────────┬──────────────────────────────────────────────────┤
│ CLASSES        │  ▢ photo_01.jpg     ▢ clip_02.mp4    ▢ doc_03.pdf │
│ [filter classes…]│  [gallery][travel]  [travel]        (unclassified)│
│ ☐ gallery  (124)⚙│                                                  │
│ ☐ travel   (88) ⚙│  ▢ photo_04.jpg     ▢ photo_05      ▢ photo_06   │
│ ☐ portfolio(12) ⚙│  [gallery]          [gallery][port] [travel +2] │
│  …(searchable)  │                                                   │
│ [ + New class ] │  3 selected ▸ [ Add to class ▾ ] [ Remove ▾ ]    │
│ ───────────────│                                                   │
│ ◉ Unclassified  │  Group by ▾   Sort ▾   Size ▾                    │
└───────────────┴──────────────────────────────────────────────────┘
```

- **Class filter bar** — searchable (built for dozens of classes; never assume a small fixed set). Multi-select is **OR by default** with an **AND/OR toggle** ("any of" vs "all of"). Selected-count badges per class.
- **Unclassified** — the lone permanent built-in pseudo-filter (empty `classes[]`); mutually exclusive with selecting real classes.
- **Chips** — show 2–3 class chips + "+N" overflow per card.
- **Bulk classify** — multi-select cards → **Add to class** (creates empty memberships) / **Remove** (drops memberships).
- **One class selected ⇒ this grid becomes that class's full catalog view**: group-by on its fields, display-field selector, its metadata columns (Item 8), and a **filter for files with an empty field** (any empty user field, or a specific one — Item 10). There is **no separate per-class page**; the per-class view is just All Files filtered to one class.

### 7.2 Per-file editor (current in-page pane — unchanged routing)

Selecting a file in the grid opens it in the existing editor pane (no new route; file-based routing deferred → Item 20).

```
photo_04.jpg                              [ open ] [ ⓘ info ] [ delete from disk ⚠ ]
──────────────────────────────────────────────────────────────────────────────────
Classes:  [gallery ✕]  [portfolio ✕]                          [ + Add to class ▾ ]
──────────────────────────────────────────────────────────────────────────────────
▾ gallery
    caption [______]  album [____]  rating [★★★☆☆]            [remove from gallery]
▾ portfolio
    title   [______]  year  [____]                            [remove from portfolio]
```

- One collapsible **section per class the file belongs to**, each rendering that class's schema (all field types: string/number/boolean/dropdown/list/url/file, incl. the file picker and missing-file indicators).
- **Add to class** → appends a section with **blank fields** (fill inline; required fields are not pre-prompted — consistent with bulk).
- **Remove from this class** → drops just that membership/metadata (the common, safe action).
- **Delete from disk** → rare, confirmed, global (strips from every class).
- **Intrinsic info** (size, dimensions, type, EXIF) stays under the existing **info bubble (ⓘ)**, separate from class sections.

### 7.3 Class management

- **+ New class** (sidebar) → name it (id = slug, fixed; `displayName` editable later) → existing **schema editor** (no "kind" choice — all classes are blob-membership). Empty schema is allowed (pure tag).
- **⚙ per class** → edit schema / rename `displayName` / delete (guarded — destroys that class's metadata, spares blobs).
- Classes are **not** overview tiles; they live entirely inside the Files hub. No reserved classes.

### 7.4 Missing-files warning (global)

App-wide indicator in the top nav/header (or overview) — appears **only** when dangling references exist anywhere (classes _or_ `records/`):

```
⚠ 3 files missing — click to review
   ├─ photo_07.jpg (id 9f2a…)
   │    ├─ travel · "Santorini sunset"        [clear] [re-pick]
   │    └─ notes  · "Trip log" (cover_image)  [clear] [re-pick]
   └─ clip_02.mp4 (id 4be1…)
        └─ gallery · "Reel B"                 [clear] [re-pick]
```

Filename shown is the manifest's last-known `file_name`. Not a filter — a triage surface with the existing Clear / re-pick actions (Item 2).

## 8. Routing

**Unchanged for now.** Keep the current in-page model: a Files hub page with the editor pane, selecting a file/class in-page (no per-file or per-class URL). Deep-linkable file-based routing (`/media/file/[id]`, per-class routes, shareable view URLs) is **deferred** → Item 20.

## 9. Migration

This is a **real `upgrade-data` migration** (explicit-only, `npm run upgrade-data -- <root> --apply`) plus a `test-fixtures/` regen in the same change (per `CLAUDE.md` discipline):

- `<root>/files/` → `<root>/media/files/`; `files/manifest.json` → `<root>/media/manifest.json` (add `classes[]` per entry, built from the migrated catalogs).
- Each `images`/`generic`/`blob_store`-kind type folder (`<root>/<typeId>/{settings.json,data.json}`) → `<root>/media/classes/<typeId>.json` (`{ schema, config, records }`); drop `excludedFiles`; rows already keyed by `id` (the blob's manifest id) carry over.
- `json`-kind types (incl. `globals`) → stay in place until Item 18 lands (`records/` reorg); the media-side migration must not break them.
- Collapse `RESERVED_TYPE_IDS` on the media side; `files`/`globals` special types are no longer media types.

## 10. Code impact (pointers for implementation)

Storage (`src/lib/storage/`):

- `paths.ts` — new `media/` root resolution (`getGlobalFilesDir` → `media/files/`, manifest → `media/manifest.json`, classes dir). Retire `usesImageRepoKind` per-kind branching toward "blob + class".
- `manifest.ts` — add `classes[]` to entries; incremental update on membership write; mtime-gated resync from class files (Option C); keep `mintFileId`/`renameFileId`/`removeFileId`/`reconcile` + lock-before-catalog ordering.
- `repo.ts` — class persistence (`media/classes/<id>.json` = `{ schema, config, records }`), opt-in membership (add/remove), remove `linked/unlinked/excluded` tri-state and `excludedFiles`; All Files listing reads the manifest; one-class listing = catalog view.
- `mediaTypes.ts` — class CRUD replaces image/generic type CRUD; drop `ensureFilesGroupExists`/`ensureGlobalsGroupExists` reserved logic on the media side; `RESERVED_TYPE_IDS` empties (media side).
- `settingsFile.ts` — `media/settings.json` (views, class ordering, global prefs); per-class `config` in class files.
- `mediaKinds.ts` — `isBrowseFirstFileKind` etc. simplify; "class" replaces image/generic kinds.
- `migrate.ts` / `scripts/upgrade-data.mjs` — the §9 migration.

Server / API (`src/routes/api/...`, `src/lib/server/imageRepo.ts`):

- Routes reshape from `media-types/[typeId]/...` toward a Files/classes surface (All Files list, per-class list = filtered, membership add/remove, class CRUD). Keep the `^[a-zA-Z0-9_-]+$` traversal guard for class ids and the `global-file-usage` cross-reference route (now powering the missing-files warning).
- Image processing (`fileMetadata.ts`, upload HEIC convert, EXIF) becomes **per-blob**, not per-class.

Frontend:

- `MediaTypeOverview.svelte` — overview drops class tiles; shows Files hub + (deferred) records.
- All Files view (new home) with the class filter bar, Unclassified toggle, bulk classify, missing-files warning.
- `ImageEditorPane.svelte` — per-file editor with one section per class + Add/Remove to class + info bubble.
- `GlobalsEditorPane.svelte`/`JsonEditorPane.svelte` — untouched until Item 18 (records side).
- `src/lib/api/client.ts` — class/membership fetch wrappers replace `*ForType`.

## 11. Deferred / linked work

- **Item 18** — `records/` reorg (json side), parallel to `media/`.
- **Item 19** — per-class "should/shouldn't be here" triage (the productive half of `excludedFiles`).
- **Item 20** — file-based routing.
- **Item 8** — verbose/configurable grid display (feeds the one-class catalog view).
- **Item 10** — empty/missing-field filter (the one-class view's empty-field filter).
