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
