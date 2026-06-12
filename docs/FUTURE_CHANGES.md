# Future Changes

Planned improvements and features that were identified during the codebase audit but deferred to later work.

---

## 1. File Field Picker UI

**Priority**: High  
**Context**: The `file` field type is now supported in the schema (can be created, filtered, stored), but the editor UI doesn't yet have a specialized picker for it.

### What's needed
- A file-picker component for `file` type fields in `ImageEditorPane.svelte` and `JsonEditorPane.svelte`
- Should list files from the global `files/` directory (via blob_store API)
- Allow searching/filtering available files
- Show a thumbnail preview for image files
- Display the current value as a clickable link

### Current state
- Schema creation, validation, filtering, and default values all work for `file` fields
- The field renders as a plain text input (inherited from the default `string` fallback)

---

## 2. Missing File Indicators (API + UI)

**Priority**: Medium  
**Context**: JSON records with `file` type fields may reference files that no longer exist in `files/`. The API should flag these broken references.

### API design (agreed)
- **List endpoint**: Return `missing_file_fields: string[]` on each list item (field keys with missing file references)
- **Record detail**: Return `_missing_files: Record<string, string>` mapping field key → expected filename for broken refs

### UI design
- Show a warning badge on list items with missing files
- Show inline warnings in the editor pane next to broken file fields
- Optionally offer a "clear" action to reset the field value

---

## 3. Bulk Operations

**Priority**: Low  
**Context**: The multiselect system exists but has limited actions.

### Potential features
- Bulk-update a field across selected records
- Bulk-delete selected records
- Bulk-export selected records as JSON

---

## 4. Schema Import/Export

**Priority**: Low  
**Context**: Media types have embedded schemas. Users may want to share or duplicate schemas.

### What's needed
- Export schema as standalone JSON
- Import schema from JSON (merge or replace)
- Clone schema from another media type

---

## 5. Data Validation & Repair

**Priority**: Low  
**Context**: Records may have orphaned keys (schema field deleted, value remains) or type mismatches.

### What's needed
- A "repair" action that scans all records and:
  - Removes keys not in schema
  - Coerces values to match field type
  - Reports and optionally fixes issues

---

## 6. Stable File IDs (decouple identity from filename)

**Priority**: Medium
**Context**: Today the **filename** (`file_name` basename in the shared global `files/` store) is the cross-catalog primary key. The same blob can be referenced by many catalogs, so a rename must fan out across every media type — rewriting record `file_name`, embedded `url`/`file`/array field values, and `settings.excludedFiles` — via `propagateFilenameRename` in [`repo.ts`](../src/lib/storage/repo.ts). This is O(number of media types) per rename and breaks if any reference path is missed (e.g. the blob-store `unlinked:` rename bug we just fixed). Full pros/cons analysis lives in [`STABLE_FILE_IDS.md`](STABLE_FILE_IDS.md).

### What's needed
- A global file **manifest** (e.g. `files/manifest.json`) mapping `file_id -> { file_name, size, hash?, created_at }` — the single place the filename lives.
- Catalogs reference `file_id` instead of `file_name`; display name resolved via the manifest.
- Rename becomes a **single manifest update** instead of a workspace-wide rewrite.
- A migration pass (extend [`scripts/upgrade-data.mjs`](../scripts/upgrade-data.mjs)) to: generate the manifest for existing blobs, rewrite all catalog refs (including embedded `url`/`file`/`excludedFiles` values) to ids, and report conflicts without clobbering.
- A reconcile/repair path for files added or removed outside the app (startup scan, lazy heal, or explicit "rescan").

### Recommended approach (from the design note)
- **Option 3** — reference by id, keep human-readable names on disk: catalogs store `file_id`, blobs keep readable names, manifest maps id↔name. Most of the benefit (atomic rename, no string drift, dedupe/metadata hooks) without an opaque `files/` directory.
- Defer **Option 4** (full content-addressed storage) unless immutability/dedupe becomes a product goal.

### Open questions
- ID scheme: random UUID (simple) vs. content hash (enables dedupe, but identical content collapses on rename)?
- Where the manifest lives and how it's reconciled with on-disk reality.
- Whether to unify `file_id` with the per-catalog record `id` or keep them distinct.

### Benefits unlocked
- O(1) atomic rename; no dangling references from string drift.
- Duplicate detection / dedupe via content hash.
- Safe display-name collisions (two blobs named `IMG_001.jpg` can coexist).
- Centralized per-file metadata (size, hash, created time, tags).

---

## 7. Static Site Export (no runtime API for customers)

**Priority**: Medium
**Context**: The app is a SvelteKit server (Node adapter) that reads/writes the data root at runtime via `/api/...` routes ([`src/routes/api`](../src/routes/api)). For **publishing**, a customer shouldn't need to run/manage a live API: they should be able to edit their data locally, then **rebuild a static site** they can host on any static host (S3, GitHub Pages, Netlify, etc.). This is a separate **read-only export** target, not a replacement for the editing app.

### What's needed
- A build script (e.g. `npm run export -- <root> --out <dir>`) that:
  - Reads every media type from `MEDIA_MANAGER_ROOT` using the existing storage layer ([`mediaTypes.ts`](../src/lib/storage/mediaTypes.ts), [`repo.ts`](../src/lib/storage/repo.ts), [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts)) — reuse, don't duplicate, the read logic.
  - Emits static JSON snapshots per type (catalog + schema + globals) and copies referenced blobs from the global `files/` store into the output (e.g. `out/files/...`).
  - Generates a static, read-only browsing UI (galleries, record views, filters that run client-side) with no write endpoints.
- A clear split between **editor** (server, read/write) and **published site** (static, read-only).

### Design considerations
- **Adapter strategy**: a dedicated read-only route tree built with `@sveltejs/adapter-static` + prerendering, OR a standalone generator that emits HTML/JSON. The current API routes can't be prerendered as-is (they mutate state), so export should target a separate read-only view, not the live `/api` surface.
- **Client-side features**: filtering/search/sort must run against the prebuilt JSON in the browser (no server). Decide which of the existing [`filters.ts`](../src/lib/core/filters.ts) capabilities to port client-side.
- **Asset volume**: blob stores can be large; support selective export (per media type, or only `linked`/non-excluded files), image resizing/thumbnail generation, and content hashing for cache-busting.
- **Path/identity stability**: published asset URLs should be stable across rebuilds — this is **much simpler if Item 6 (stable file IDs) lands first**, since ids give durable, collision-free asset names. Worth sequencing #6 before/with #7.
- **Globals + schema**: include the globals singleton and per-type schema so the static UI can render labels, field types, and dropdown options without the server.
- **Incremental rebuilds**: ideally only re-emit changed types/assets (hash- or mtime-based) so large datasets rebuild quickly.

### Open questions
- One static bundle per media type, or a single combined site with navigation?
- How much interactivity (filters, compare view) to keep vs. a pure read-only gallery?
- Hosting target assumptions (flat static host vs. one allowing redirects/clean URLs)?

---

## 8. Configurable & Verbose Grid Display

**Priority**: High (user-requested)
**Context**: The grid views surface very little per card today. The JSON grid ([`JsonRecordGrid.svelte`](../src/lib/components/JsonRecordGrid.svelte)) shows a single label via `getDisplayName` (the `name` field, else `group_by_value`, else the id prefix) — there's no way to choose which field is shown or to see several fields at once. The image grid ([`ImageViewGrid.svelte`](../src/lib/components/ImageViewGrid.svelte)) shows the thumbnail plus one display name. Users want (a) to pick which field is displayed for JSON records, and (b) a "verbose" mode that shows a lot of information at once for visual scanning (lightroom-style). Supersedes the `tasks.md` "Verbose mode", "larger grid view", and "experiment with an image grid renderer" notes.

### What's needed
- **Display-field selector** in the grid header (mirroring the existing Group by / Size selectors) to choose which schema field is the primary label for JSON records.
- **Verbose view mode** toggle that renders a multi-field card (key/value rows or compact chips) showing a chosen subset of fields per record; for image grids, show metadata fields next to a larger thumbnail.
- **Field-subset picker** for verbose mode (multi-select of schema fields) with a sensible default (e.g. `name`/`image_name` + first few user fields).
- Persistence: per-session via selection state and/or durable per-type defaults via settings.

### Implementation pointers
- Generalize `getDisplayName` in [`JsonRecordGrid.svelte`](../src/lib/components/JsonRecordGrid.svelte) to render the selected field(s); reuse the `gridSchemaFields` fetch and the Group by/Size `Select` pattern already present in both grids.
- Extend selection state ([`selection.svelte.ts`](../src/lib/state/selection.svelte.ts), which already holds `gridGroupByField`/`gridSize`) with `gridDisplayField` / `gridVerbose` / `gridVerboseFields`; optionally persist defaults in [`settingsFile.ts`](../src/lib/storage/settingsFile.ts) + the `.../settings` API.
- List items are currently sparse (the list response carries `group_by_value` but not arbitrary field values). Verbose/custom display needs the selected field values per item — either extend the list response (`records/list` + repos) to include requested fields, or fetch per record. Prefer extending the list response for grid performance.

### Open questions
- Per-type persistent default vs. per-session only?
- Verbose layout: key/value rows, a mini table, or chips?
- How many fields before large lists get noisy / slow, and do we cap or virtualize?

---

## 9. Sorting & Ordering

**Priority**: Medium
**Context**: Grids and lists support Group by and filters but have no explicit sort. From `tasks.md`: "optionally organize by timestamp."

### What's needed
- A sort control (field + direction) in the grid/sidebar headers.
- Built-in sorts: by `last_modified`/created timestamp, by name, and by any schema field.
- Persist the choice per type and/or session.

### Implementation pointers
- Apply sorting in the list endpoints (`records/list`) via the repos ([`repo.ts`](../src/lib/storage/repo.ts) `listImages`, [`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts)), with the active sort tracked in selection state.

---

## 10. Filter for Missing / Empty Fields

**Priority**: Medium
**Context**: From `tasks.md`: "filter for images with missing fields." The filter engine ([`filters.ts`](../src/lib/core/filters.ts)) already supports multi-clause filters including empty checks, but there's no first-class "show records with missing/empty fields" entry point. Complements Item 2 (missing **file** references).

### What's needed
- A quick filter for records with any empty user field, or a specific empty field.
- Compose with existing multi-clause filters; surface it in the sidebar filter UI.

---

## 11. AI / External Field Enrichment (application-specific)

**Priority**: Low (downstream apps; not core)
**Context**: Ideas from `tasks.md` aimed at specific downstream uses (e.g. a food/web catalog), not the core local tool. Listed so they aren't lost.

### Ideas
- Auto-fill schema fields via an external vision API (labels, OCR, etc.).
- Offline semantic search over the enriched fields.
- A local vector database over field values (and possibly EXIF) for fast, fully-local search.

### Considerations
- Keep the core app provider-agnostic; gate any integration behind opt-in config.
- Privacy: prefer local-first; be explicit when data would leave the machine.

---

## 12. Fix / Normalize File Extension

**Priority**: Low
**Context**: From the vault backlog: "some sort of option to fix the file extension." Uploaded blobs may carry a wrong, missing, or mis-cased extension (e.g. a JPEG named `.jpeg` vs `.jpg`, or no extension), which affects per-kind extension filtering in `images` catalogs.

### What's needed
- A per-file action to rename the extension (reusing the existing rename/`propagateFilenameRename` path in [`repo.ts`](../src/lib/storage/repo.ts) so cross-catalog references stay intact).
- Optionally detect the true type (magic bytes / sharp) and suggest the correct extension.

### Considerations
- Sequence after / alongside Item 6 (stable file IDs): if identity decouples from filename, an extension fix becomes a pure display-name change.

---

## 13. Swap Width/Height (orientation fix)

**Priority**: Low
**Context**: From the vault backlog: "add a swap width/height option (for bugs) — or have a warning if they are swapped and recommend fixing them." Stored `width`/`height` (written automatically on upload) can end up transposed for some rotated/EXIF-oriented images.

### What's needed
- A per-record action to swap the stored `width` and `height` values.
- Optionally a heuristic warning when stored dimensions appear inconsistent with the actual decoded image (compare against `sharp` metadata) and offer the swap.

---

## 14. Markdown Blog Media Kind

**Priority**: Medium (part of the original multi-type vision)
**Context**: From the vault backlog: "support markdown blogs as a project type — have a setting as to whether to include the metadata in the yaml, or just in a json as well, or sync between." A `markdown` kind would manage a set of markdown files (e.g. blog posts) with schema-driven metadata, alongside the existing `images`/`generic`/`json`/`blob_store` kinds.

### What's needed
- A new `markdown` value in [`MediaTypeKind`](../src/lib/storage/settingsFile.ts) and a repository (likely a sibling of [`repo.ts`](../src/lib/storage/repo.ts)/[`jsonRepo.ts`](../src/lib/storage/jsonRepo.ts)) that lists/reads/writes `.md` files.
- A dedicated editor pane for markdown body + metadata, switched on by kind in [`media/[typeId]/+page.svelte`](../src/routes/media/[typeId]/+page.svelte).
- A metadata-source setting: store metadata in the file's YAML frontmatter, in a sidecar JSON catalog, or keep both in sync.

### Open questions
- Frontmatter as source of truth vs. JSON catalog vs. bidirectional sync — sync is the most useful but the hardest to keep consistent.
- How body content interacts with filtering/search (Item 10) and grid display (Item 8).

---

## 15. Image Compression Management

**Priority**: Low (explicitly non-urgent in the vault note)
**Context**: From the vault backlog: a way to manage compressed variants of images. Idea: keep a folder of compressed copies, regenerate them on upload/modify, store paths to both the original and compressed variant in the catalog, and let the user pick which to use.

### What's needed
- A per-media-type compression setting (e.g. quality/target size).
- On upload/modify, generate a compressed variant (via `sharp`) into a dedicated location and record both paths.
- UI to choose original vs. compressed per record (or per export — ties into Item 7 Static Site Export, which also wants thumbnails/resizing).

### Considerations
- Strong overlap with Item 7's asset-volume concerns (thumbnails, selective export); consider designing them together to avoid two parallel resize pipelines.

---

## 17. Capture Nested Folder Path on Folder Upload

**Priority**: Medium (user-requested)
**Context**: When a user uploads a **folder** containing nested subfolders, the directory structure is lost today — all blobs land flat in the shared global `files/` store (`getGlobalFilesDir()`), and only the basename (`file_name`) is recorded. Users want the option to **automatically save each file's relative path within the dropped folder** (e.g. `2024/trip/photo.jpg`) into a schema field, so the original organization isn't lost when files are flattened into the global store.

### Decisions (from clarification)
- **Captured value**: the **relative path within the uploaded folder** (not absolute, not just the parent segment). Portable and describes the import's internal structure.
- **Storage target**: at upload time, the user **picks an existing schema field** to receive the path (e.g. a `string` field). Not auto-created and not a reserved key — the user opts in per upload by choosing where it goes.
- **Browser limitation (accepted)**: a browser only exposes relative paths via a folder picker (`<input webkitdirectory>` / `webkitRelativePath`) or the drag-and-drop `FileSystemEntry` API. True absolute filesystem paths are **not available** from the browser, so this feature is **relative-path-only**. (A CLI/server-side import could capture absolute paths later — out of scope here.)

### What's needed
- Folder upload that preserves per-file relative paths: use `<input type="file" webkitdirectory>` and/or drag-drop directory traversal (`DataTransferItem.webkitGetAsEntry()` → recurse) so each `File` carries its `webkitRelativePath`.
- An upload-time option ("Save folder path to field") with a **field selector** (existing schema fields, likely `string`/`url`-typed) — mirror the Group by / display-field `Select` pattern already used in the grids.
- On import, write each file's relative path into the chosen field on the created/linked catalog record, alongside the existing `file_name`.
- Wire through the upload path in [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) and the file-backed repo write in [`repo.ts`](../src/lib/storage/repo.ts); the relative path must ride along with each uploaded file from client → API → record.

### Open questions
- **Filename collisions**: the global store is flat, so `a/photo.jpg` and `b/photo.jpg` collide on `file_name`. Do we de-dupe/rename on import (and is the relative path then the disambiguator)? Sequences naturally after Item 6 (stable file IDs), which removes filename-as-identity.
- Should the path field be **auto-populated only when empty**, or always overwritten on re-upload?
- Default field choice / remembering the last-used field per media type (persist in [`settingsFile.ts`](../src/lib/storage/settingsFile.ts)?).
- Drag-and-drop directory support is more involved than the `webkitdirectory` input — ship the input first, drag-drop folders later?

---

## 16. Open Design Questions

**Priority**: n/a (decisions to make before related work)
**Context**: Carried over from `tasks.md` so the backlog is captured in one place.

- **Default values**: is storing explicit defaults (beyond `false` for booleans / `0` for numbers) worth it, or is filtering for empty values sufficient?
- **Svelte usage guidance**: expand [`.cursor/rules/svelte5.mdc`](../.cursor/rules/svelte5.mdc) with an explicit do/don't list, including when `$bindable` is appropriate vs. confusing.
