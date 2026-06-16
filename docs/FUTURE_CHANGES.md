# Future Changes

Planned improvements and features that were identified during the codebase audit but deferred to later work.

> **Major in-flight design:** the **file-first "classes" redesign** — see [`FILE_FIRST_CLASSES.md`](FILE_FIRST_CLASSES.md). It is the umbrella for Items **18** (records reorg), **19** (per-class triage), and **20** (file-based routing), and informs Items **8** and **10**.

---

## 1. File Field Picker UI — ✅ Shipped

**Status**: **Shipped.** `file`-type fields render [`FilePicker.svelte`](../src/lib/components/FilePicker.svelte) in [`ImageEditorPane.svelte`](../src/lib/components/ImageEditorPane.svelte) and [`JsonEditorPane.svelte`](../src/lib/components/JsonEditorPane.svelte): a dialog over the global blob store with debounced search and image thumbnails, storing the chosen blob's `file_id`. The selected value shows an inline thumbnail (for images) + filename + open-in-new-tab link + clear, and can be re-picked. See the "File field picker" row in [`FEATURES.md`](FEATURES.md).

---

## 2. Missing File Indicators (API + UI) — ✅ Shipped

**Status**: **Shipped.** A `file`-field value pointing at a blob that is absent from disk/manifest is flagged end-to-end. Detection helpers live in [`manifest.ts`](../src/lib/storage/manifest.ts) (`getAvailableFileIds`, `missingFileFields`, `missingFilesMap`); list endpoints (`listImages`/`listRecords`) return `missing_file_fields: string[]` per item, and record detail (both `getRecordById`) returns `_missing_files: Record<string, string>` (field key → expected filename). The grids ([`ImageViewGrid`](../src/lib/components/ImageViewGrid.svelte), [`JsonRecordGrid`](../src/lib/components/JsonRecordGrid.svelte)) show a subtle warning badge on affected cards, and the editor panes show an inline warning with **Clear** + re-pick. See the "Missing-file indicators" row in [`FEATURES.md`](FEATURES.md).

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

## 6. Stable File IDs (decouple identity from filename) — ✅ Shipped

**Status**: **Shipped (Option 3).** Blobs are now identified by a stable, workspace-scoped id in a global manifest ([`files/manifest.json`](../src/lib/storage/manifest.ts)); a file-backed catalog row's `id` value **is** that manifest id, and the filename is resolved from the manifest at read time. Rename is an O(1) manifest update (the old `propagateFilenameRename` fan-out is gone), the `unlinked:` id scheme is gone (an unlinked file is a manifest id with no row; linking keeps the same id), `excludedFiles` and `file`-field values store ids, and list calls lazy-heal the manifest against disk (`healed: { added, missing }` + a toast). See [`STABLE_FILE_IDS.md`](STABLE_FILE_IDS.md) and the "Shared global blob store + manifest" section of [`FEATURES.md`](FEATURES.md).

### Decisions locked at implementation

- **id = random UUID** (not a content hash); a `hash?` slot may be added later.
- **Unified identity on `id` everywhere** (disk + API + selection + json). A file-backed row's `id` value is the blob's manifest id (shared across catalogs); a `json` row's `id` is record-local. They share the field name and differ only in uniqueness scope (documented on `ImageRecordSchema`). The per-row `id` value and stored `file_name` from the old layout were removed.
  - *(Interim note: the first implementation keyed file-backed rows by a distinct `file_id` field; that was renamed to `id` for whole-system consistency. The migration handles both layouts, and `manifest.ts` / the `*FileId` helpers keep "file id" as the name for the manifest concept.)\*
- **Migration is explicit-only** via `npm run upgrade-data -- <root> --apply` (Check 4); the app errors loudly on a row not in the current `id`-keyed shape rather than fabricating identity.

### Follow-ups not in scope of the initial ship

- Content hashing for dedupe / duplicate detection (would change the name-based idempotency assumption — documented in [`manifest.ts`](../src/lib/storage/manifest.ts)).
- Clearing embedded `file`-field references (not just whole rows) when a blob is deleted.
- Centralized per-file metadata beyond `size`/`created_at` (tags, hash).

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

## 18. Records Storage Reorganization (to discuss)

**Priority**: n/a (deferred discussion — flagged during the file-first / classes redesign)
**Context**: As part of reorganizing the on-disk data root for the file-first "classes" model — renaming `files/` → `media/` with `media/files/` (blobs), `media/classes/` (per-class catalog JSON), and `media/settings.json` (saved views/filters) — we want to apply a parallel reorganization to the `json`-kind side under a top-level `records/` folder.

### Sketch (not decided)

- `records/` containing a folder for the json record files, plus a `records/settings.json`.
- Open: how `globals` (the reserved json singleton) fits; whether each json "type" is a subfolder; what lives in `records/settings.json` vs. per-type settings; migration from today's per-type top-level folders.

**Decision: revisit after the images/classes storage layout is settled.**

---

## 19. Per-Class "Should / Shouldn't Be Here" Review (excludedFiles successor)

**Priority**: Low (post file-first/classes redesign)
**Context**: The file-first "classes" redesign removes the old per-class `excludedFiles` list entirely (membership becomes opt-in: a file is simply not a member until tagged, and "unclassified" is derived from zero memberships). This item reintroduces the _useful_ part of exclusion — **triage** — without the old opt-out burden.

### Idea

A per-class review affordance that helps answer "which files should be in this class vs. not?":

- Per class, mark a file as **dismissed / not-relevant** so it stops showing up as a suggestion/candidate for that class (the productive half of the old `excludedFiles`), without affecting any other class.
- A review/triage view: for a given class, show candidate files (e.g. unclassified, or matching some heuristic) and let the user quickly add-to-class or dismiss.
- Strictly per-class and opt-in — never a global hide; "unclassified" remains derived from membership.

### Considerations

- Store dismissals inside the class JSON file (source of truth), mirrored into the manifest membership index alongside `classes` if useful for fast filtering.
- Keep distinct from deletion-from-disk (which still strips a blob globally) and from "remove from this class" (drops membership/metadata).

---

## 20. File-Based Routing (to discuss)

**Priority**: n/a (deferred discussion — flagged during the file-first/classes redesign)
**Context**: Today editing happens inside a single `/media/[typeId]` page that switches editor panes by kind and selects records in-page (no per-record URL). The file-first/classes redesign keeps this in-page model for now (the per-file editor stays an editor pane on the Files hub page, not a drawer or dedicated route). In future we'd like **more file-based routing** — e.g. deep-linkable per-file routes (`/media/file/[id]`), per-class routes, and shareable view/filter URLs — so app state is addressable and bookmarkable.

**Decision: revisit after the file-first/classes model ships; design the route tree then.**

---

## 16. Open Design Questions

**Priority**: n/a (decisions to make before related work)
**Context**: Carried over from `tasks.md` so the backlog is captured in one place.

- **Default values**: is storing explicit defaults (beyond `false` for booleans / `0` for numbers) worth it, or is filtering for empty values sufficient?
- **Svelte usage guidance**: expand [`.cursor/rules/svelte5.mdc`](../.cursor/rules/svelte5.mdc) with an explicit do/don't list, including when `$bindable` is appropriate vs. confusing.
