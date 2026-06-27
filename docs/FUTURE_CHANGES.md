# Future Changes

Non-committal backlog of deferred improvements identified during codebase audits. **This is not the shipped feature set** — that's [`FEATURES.md`](FEATURES.md). Items here are candidates, not commitments.

> **🚀 1.0 release plan:** a committed subset of these items is scheduled for **1.0** — see [`plans/v1.0/README.md`](plans/v1.0/README.md) (per-feature briefs + the agile interview → HTML-plan → verification process). Committed: Items **8 · 9 · 10 · 3 · 5 · 12 · 13 · 34 · 15 · 18 · 19** and the npx sub-project (**30 · 31 · 32 · 33**). When one of those ships, retire it here as usual.

> **How to read & maintain this file:** see the **"Managing FUTURE_CHANGES.md"** section in [`../CLAUDE.md`](../CLAUDE.md). The short version: items are grouped by **cluster** (not by number), every active item carries a machine-readable **frontmatter block**, item **numbers are immutable IDs** (never renumber — they're cross-referenced from `FEATURES.md` and the plan docs), and `status: ready` is a promise that an agent can pick it up with **zero open questions**.

## Frontmatter legend

Each active item opens with a fenced `yaml` block:

```yaml
status: ready # ready | blocked | discussion | shipped
size: M # S (hours) | M (a day) | L (multi-day / design-heavy)
usefulness: 3 # 1–5 — product leverage / value to the user
priority: medium # high | medium | low
files: [path, …] # current owning files (verified, not stale)
depends_on: [] # item numbers that must land first
open_questions: 0 # count of unresolved design decisions
acceptance: # what "done" looks like — the agent's definition of success
  - …
```

**The cardinal rule:** `status: ready` ⇔ `open_questions: 0`. The moment an item has an unresolved design decision it is `blocked` (engineering unknown) or `discussion` (product/scope unknown) — **never `ready`**. An agent should be safe to grab any `ready` item and finish it without coming back to ask.

## Cluster index

| Cluster | Items | Theme |
| --- | --- | --- |
| [npx-package vision](#cluster-npx-package-vision) | 30 · 31 · 32 · 33 · 7 | Run media-manager as an npx package inside a host repo |
| [Data model & fields](#cluster-data-model--fields) | 36 · 26 · 25 · 4 · 0 | Field types, value editors, globals parity |
| [Media kinds & preview](#cluster-media-kinds--preview) | 23 · 21 · 24 · 14 | Expand beyond images — video/gif, pdf, docx, markdown |
| [Grid & display](#cluster-grid--display) | 8 | What each tile shows; verbose mode |
| [Asset pipeline & deps](#cluster-asset-pipeline--deps) | 15 · 34 · 35 | Thumbnails, masonry, the `sharp` decision |
| [Bulk & schema utilities](#cluster-bulk--schema-utilities) | 3 · 5 | Mostly shipped — small remainders to close |
| [Integrations](#cluster-integrations) | 37 · 11 | External services, kept opt-in and out of core |
| [Storage & routing — design](#cluster-storage--routing--design) | 20 · 18 · 19 · 16 | Decisions to make before code |
| [Misc fixes & polish](#cluster-misc-fixes--polish) | 17 · 12 · 13 · 29 | Small, self-contained quality-of-life |
| [Shipped & folded](#shipped--folded) | 1 · 2 · 6 · 22 · 28 · 27 · 9 · 10 | Archive — see `FEATURES.md` |

> A visual triage board over this same data lives at [`FUTURE_CHANGES_TRIAGE.html`](FUTURE_CHANGES_TRIAGE.html) (open in a browser) — filter by status/size/flags and rank by usefulness. **Keep the two in sync** when you add, close, or re-score an item.

---

## Cluster: npx-package vision

Running media-manager as an **npx package inside a host repo** (e.g. `nicb.at`, workspace at `src/assets/media_manager`). Full design: [`plans/npx-package-vision.md`](plans/npx-package-vision.md) (+ diagram [`npx-package-vision.html`](npx-package-vision.html)). Decisions locked 2026-06-20: **editor-first**, distribute as a **local dep** for now (publish later). Items 30/31/32 are the "safe to open committed data" trio.

### 30 · Editor npx Setup — Zero-Config Root Discovery (Mode A)

```yaml
status: blocked
size: L
usefulness: 4
priority: medium
files: [bin/media-manager.js, src/lib/storage/paths.ts]
depends_on: []
open_questions: 3
acceptance:
  - Bare `npx media-manager` from inside a host repo finds the workspace with zero config
  - Root-resolution precedence chain implemented (arg → env → config file → convention auto-detect → friendly error)
  - `media-manager.config.json` loader (parse/validate; resolve `root` relative to the config file, not cwd)
  - CLI grows verbs (`serve` default, `init`, `doctor`) while keeping the bare/positional form
```

Today [`bin/media-manager.js`](../bin/media-manager.js) **requires** an explicit `<root-dir>` and errors without it. Goal: bare `npx media-manager` discovers the right folder. This is the "editor" half (Mode A — the server that _mutates_ the root), distinct from Item 33 (read-only reader). Distribute as a **local dep** (host `package.json` `file:../media-manager` or git URL) for now; publishing is a later phase (folds in former Item 27 — the npm `bin`/`files`/`engines` fields, prepublish build, scoped name `@nicbat/media-manager`, cross-platform native-dep audit of `exiftool-vendored`/`heic-convert`).

**Open questions:** (1) precedence when both config file and env/arg present — arg/env should win, confirm + document; (2) auto-detect walks **up** the tree (monorepo-friendly) vs. probes `cwd` only; (3) `init` scaffolding — reuse the app's own first-launch healing for the empty workspace rather than hand-rolling.

### 31 · Ephemeral Server Port + Auto-Open (drop the fixed PORT)

```yaml
status: blocked
size: M
usefulness: 3
priority: medium
files: [bin/media-manager.js]
depends_on: []
open_questions: 2
acceptance:
  - Server binds an ephemeral port (port 0 → OS-assigned) and auto-opens the actually-bound URL
  - `port`/`PORT` removed from the config surface + docs (keep an optional `--port`/`PORT` override)
  - Auto-open fires on a readiness signal, not a fixed setTimeout guess
```

A fixed `PORT=3000` collides with the host's dev server. The server itself is **mandatory** (real FS IO, `exiftool-vendored`, `heic-convert`, manifest locking — can't be a static page) but the fixed port isn't.

**Open questions / main spike:** does `@sveltejs/adapter-node` accept `PORT=0` and let us read back the bound port? If not, the CLI may need to pre-bind a probe socket (race-y) or parse the "listening on" stdout line. **Research this before building.** Second: auto-open timing once the bound port is known.

### 32 · Quiet Heal — Persist Manifest Reconcile Only on Real Change

```yaml
status: blocked
size: M
usefulness: 4
priority: medium
files: [src/lib/storage/manifest.ts, src/lib/storage/manifest.test.ts]
depends_on: []
open_questions: 3
acceptance:
  - `reconcile` (and the membership-index resync) diff against on-disk state and skip the write when equivalent
  - Browsing a clean, git-committed workspace produces zero `git status` churn
  - `healed: { added, missing }` + the toast still fire for real changes
  - Unit coverage asserts "no change ⇒ no write" and "real change ⇒ write + report"
```

Every list call lazy-heals the manifest ([`manifest.ts`](../src/lib/storage/manifest.ts) `reconcile`), so _just browsing_ a git-committed workspace can rewrite `media/manifest.json` (mtime/no-op churn) and dirty the tree. Chosen **over** a hard `--read-only` mode (which would block editing). Load-bearing path (manifest lock taken before any class lock) — needs the unit coverage above.

**Open questions / research:** (1) is the churn from `reconcile`, the mtime-gated membership resync, or `settings.json` healing — audit which write paths fire on a pure browse; (2) does any caller depend on the manifest mtime advancing every list (the mtime-gated resync)?; (3) equivalence granularity — structural deep-equality is safer than byte-equal JSON against formatting drift.

### 33 · Reader Package — Read-Only Host Integration (Mode B)

```yaml
status: discussion
size: L
usefulness: 2
priority: low
files: [src/lib/storage/paths.ts, src/lib/storage/classRepo.ts, src/lib/storage/manifest.ts, src/lib/storage/jsonRepo.ts, src/lib/core/types.ts]
depends_on: []
open_questions: 3
acceptance:
  - (Decide library-vs-export face first — do not pre-build)
  - Read functions take an explicit root (no process.env mutation) and never write/heal/lock
```

The "reader" half: let a host build (nicb.at) **consume the on-disk format** to render galleries without booting the editor — pure read-only. **Deferred** — the consumption shape stays open until nicb.at's build needs are concrete. Overlaps Item 7 (this is the programmatic/library face of the same read logic).

**The one piece worth scoping early** (Item 7 needs it too): the **root-threading refactor** — the storage layer reads the root from `process.env.MEDIA_MANAGER_ROOT` ([`paths.ts`](../src/lib/storage/paths.ts)); a library API must take an **explicit root** instead. **Open questions:** library (subpath export `media-manager/fs` with `openWorkspace(root)` etc.) vs. export CLI (denormalized JSON snapshot); blob-serving strategy (point static dir at `media/files/` vs. copy/hardlink needed blobs); on-disk format versioning.

### 7 · Static Site Export (no runtime API for customers)

```yaml
status: blocked
size: L
usefulness: 1
priority: medium
files: [src/lib/storage/mediaTypes.ts, src/lib/storage/classRepo.ts, src/lib/storage/jsonRepo.ts, src/lib/core/filters.ts]
depends_on: [6]
open_questions: 3
acceptance:
  - `npm run export -- <root> --out <dir>` reuses the storage read layer (no duplicated read logic)
  - Emits static JSON snapshots per type/class + globals + schema, copies referenced blobs
  - Generates a read-only browsing UI (galleries, record views, client-side filters) with no write endpoints
```

A customer shouldn't need to run a live API to **publish**: edit locally, then rebuild a static, host-anywhere site (S3/Pages/Netlify). A separate **read-only export** target, not a replacement for the editor. Item 6 (stable file IDs) **shipped**, so durable collision-free asset names are available — the dependency is satisfied.

**Open questions:** one bundle per type vs. a single combined site; how much interactivity (filters/compare) vs. pure gallery; hosting assumptions (flat host vs. clean URLs). Also needs the same root-threading refactor as Item 33, and overlaps Item 15's resize/thumbnail concerns (design the asset pipeline once).

---

## Cluster: Data model & fields

Field types, value editors, and globals feature-parity. The `relation` edge (36) is the high-leverage one — it turns the three sub-app "islands" into a graph.

### 36 · `relation` field type — record-to-record references

```yaml
status: ready
size: L
usefulness: 5
priority: medium
files: [src/lib/core/types.ts, src/lib/components/FieldInput.svelte, src/lib/storage/jsonRepo.ts, src/lib/components/GlobalsEditorPane.svelte]
depends_on: []
open_questions: 0
acceptance:
  - `relation` added to FieldTypeSchema with a `{ typeId, recordId }` value shape (single-target first)
  - Per-field config stores the target type id (like a dropdown's options)
  - FieldInput gains a relation editor: picks from the target type's records, renders a title chip, click-through deep-links to `/media?type=<t>&record=<id>`
  - Server normalizes/validates the target exists and flags dangling relations (mirrors the `_missing_files` pattern)
  - Globals parity: target-type hint stored in `__field_meta`
```

We have a `file` field (record→blob) but no way for a record to point at **another record** (a movie's `director` → a row in "People"). Today you retype "Christopher Nolan" in every movie — no typed pointer, no click-through. A `relation` field adds that edge. Deferred during the sub-app restructure (2026-06-22), which shipped the `?record=` deep links that make click-through trivial — so this is now unblocked and `ready`.

**Deliberately deferred (not open questions):** `relation[]` multi-target (ship single first), reverse "referenced by" back-references (needs a derived index — defer unless needed). A relation targeting a class member (blob) is what `file` already does — keep `relation` record→record to avoid overlap.

### 26 · File-Field UI Overhaul (preview + navigate-to-file)

```yaml
status: ready
size: M
usefulness: 4
priority: medium
files: [src/lib/components/FilePicker.svelte, src/lib/components/FieldInput.svelte, src/lib/components/FileEditorPanel.svelte]
depends_on: []
open_questions: 0
acceptance:
  - Larger/expandable preview of the referenced blob (reuse the FileEditorPanel lightbox; support non-image kinds as Items 23/24 land)
  - A "go to file" affordance that opens the referenced blob in the Files hub editor
  - Applied consistently everywhere FieldInput renders a `file` field (FileEditorPanel, RecordDetailPane, GlobalsEditorPane)
```

A `file`-field value is a manifest id ref, edited via [`FilePicker.svelte`](../src/lib/components/FilePicker.svelte) inside [`FieldInput.svelte`](../src/lib/components/FieldInput.svelte). Today: small inline thumbnail (images only) + filename + open-in-new-tab + clear. Users want a richer preview and a jump-to-file. The preview half is fully `ready`; the "go to file" deep-link is cleanest with stable per-file routes (Item 20) but can ship today against `/files` with the editor opened — does **not** block this item. Overlaps Item 25 (apply once in the shared `FieldInput`).

### 25 · Globals Panel Overhaul (previews + nicer layout)

```yaml
status: ready
size: M
usefulness: 3
priority: medium
files: [src/lib/components/GlobalsEditorPane.svelte, src/lib/core/fieldKeys.ts, src/lib/components/FieldInput.svelte]
depends_on: []
open_questions: 0
acceptance:
  - Rich value previews in the globals editor (image/file thumbnails, url link previews) — overlaps Item 26, design together
  - Nicer layout (grouped/sectioned fields, spacing) preserving the __field_kinds / __field_meta metadata model
  - Full parity: any field type/feature the json RecordDetailPane supports still works here
```

The reserved `globals` singleton keeps its bespoke free-form editor ([`GlobalsEditorPane.svelte`](../src/lib/components/GlobalsEditorPane.svelte)) but its presentation is plain. Per CLAUDE.md it must keep parity with `json` records. Consider converging further onto the shared `FieldInput` + panel chrome (it already feeds `FieldInput` a synthetic `FieldDefinition`) to reduce drift.

### 4 · Schema Import/Export

```yaml
status: ready
size: M
usefulness: 2
priority: low
files: [src/routes/api/media-types/[typeId]/schema, src/routes/api/classes/[id]/schema, src/lib/core/types.ts]
depends_on: []
open_questions: 0
acceptance:
  - Export a type's/class's schema as standalone JSON
  - Import a schema from JSON (merge or replace) with validation
  - Clone a schema from another media type / class
```

Media types and classes have embedded schemas; users may want to share or duplicate them. Self-contained, low priority. (Both the `json`-type and class schema endpoints already exist to build on.)

### 0 · Make URL fields editable

```yaml
status: shipped
```

**Already shipped** — [`FieldInput.svelte`](../src/lib/components/FieldInput.svelte) has a full `url` `{ display_name, url }` editor. Retained here only as a tombstone; safe to delete on the next pass.

---

## Cluster: Media kinds & preview

Expand first-class preview/handling beyond images. PDF storage + metadata already shipped (via `exiftool-vendored`); these add the previews and new kinds.

### 23 · Video & GIF Media Support

```yaml
status: ready
size: L
usefulness: 4
priority: medium
files: [src/lib/core/images.ts, src/lib/components/FileEditorPanel.svelte, src/lib/components/data-grid/DataGrid.svelte, src/lib/server/fileMetadata.ts]
depends_on: []
open_questions: 0
acceptance:
  - Recognize video (.mp4/.webm/.mov/…) + animated .gif (extend images.ts or add a sibling media.ts)
  - Inline preview — <video controls> (and GIFs as images) in FileEditorPanel + the lightbox; poster/first-frame thumbnail in DataGrid tiles
  - Thumbnail generation for the grid (first frame), mirroring the image thumbnail path
  - exiftool duration/codec/dimensions in fileMetadata.ts; [id]/blob supports range requests for seeking
```

The Files grid and [`FileEditorPanel.svelte`](../src/lib/components/FileEditorPanel.svelte) gate previews on `hasAllowedImageExtension` ([`images.ts`](../src/lib/core/images.ts)), so video/GIF fall back to the generic icon. **Deliberately decided (not an open question):** large videos load lazily via range requests; GIFs are images on disk but preview like motion.

### 21 · Full PDF Preview

```yaml
status: ready
size: M
usefulness: 3
priority: low
files: [src/lib/components/FileEditorPanel.svelte, src/lib/core/images.ts]
depends_on: []
open_questions: 0
acceptance:
  - Render PDFs inline via native browser embed (<iframe>/<embed>, no new deps) in FileEditorPanel, replacing the icon placeholder
  - Generate/serve first-page PDF thumbnails so the Files grid shows a preview instead of the icon
```

PDFs are stored, served as `application/pdf`, and read for document metadata already (see the `MetadataButton` "Document Information" section). Only the inline preview + first-page thumbnail remain — a solid scan/browse win.

### 24 · DOCX Media Support (+ convert-to-PDF)

```yaml
status: blocked
size: L
usefulness: 3
priority: medium
files: [src/lib/server/fileMetadata.ts, src/lib/components/FileEditorPanel.svelte]
depends_on: [21]
open_questions: 1
acceptance:
  - Recognize .docx/.doc; read basic metadata (title, author, word count) via exiftool
  - A per-file "Convert to PDF" action that writes + registers a new PDF blob, optionally linking back to the source
  - Once converted, the existing PDF preview/metadata path (Item 21) applies
```

Same treatment as PDFs, for Word docs, with an easy path to PDF (which the app previews + reads metadata from). **Open question (blocks):** converter choice — LibreOffice-headless (heavy, high fidelity) vs. pure-JS (light, lower fidelity) — decide against the npx-package distribution footprint (Item 30). Also depends on Item 21's PDF preview landing.

### 14 · Markdown Blog Media Kind

```yaml
status: discussion
size: L
usefulness: 3
priority: medium
files: [src/lib/storage/settingsFile.ts, src/lib/storage/mediaTypes.ts, src/routes/media/[typeId]/+page.svelte]
depends_on: []
open_questions: 2
acceptance:
  - (Redesign against the file-first/classes model FIRST — the original sketch predates it)
```

> ⚠️ **Predates the file-first redesign.** The original plan ("add a `markdown` value to `MediaTypeKind`, sibling repo to `repo.ts`, kind-switched editor pane") references a world that's gone: `MediaTypeKind` is now **`json`-only**, `repo.ts`/`blob_store`/`images` kinds were removed, and files are handled by **classes**, not media-type kinds. This needs a **redesign against classes**, not a re-link — hence `discussion`, not `ready`.

The user value (manage a set of `.md` files with schema-driven metadata, e.g. blog posts) is real and high if blogging becomes a concrete use. **Open questions:** where a markdown kind sits in the file-first model (a class over `.md` blobs? a new top-level kind?); metadata source of truth (YAML frontmatter vs. sidecar JSON vs. bidirectional sync — sync is most useful, hardest to keep consistent).

---

## Cluster: Grid & display

What each tile shows. (Sorting — Item 9 — and the empty/missing-field filter — Item 10 — shipped; see **Shipped & folded**.) Item 8 still names components removed in the file-first redesign — repointed below.

### 8 · Configurable & Verbose Grid Display

```yaml
status: blocked
size: L
usefulness: 5
priority: high
files: [src/lib/components/data-grid/DataGrid.svelte, src/lib/components/data-grid/types.ts, src/lib/stores/settings.ts, src/lib/storage/jsonRepo.ts, src/lib/storage/classRepo.ts]
depends_on: []
open_questions: 3
acceptance:
  - A field-subset picker drives a "verbose" multi-field card (key/value rows or chips) per tile
  - Image grids show metadata fields next to a larger thumbnail
  - List responses carry the requested field values per item (extend list endpoints, don't fetch per-record)
  - Choice persists (per-session and/or durable per-type default)
```

> 🔧 **Stale refs repointed.** The original pointers named `JsonRecordGrid.svelte`, `ImageViewGrid.svelte`, `getDisplayName`, and `selection.svelte.ts` — **all removed.** The single tile grid is now [`DataGrid.svelte`](../src/lib/components/data-grid/DataGrid.svelte) (+ `types.ts`), grid state lives in [`stores/settings.ts`](../src/lib/stores/settings.ts) (the `selection` store is gone), and the **display-field / title-by selector partly shipped** (per-entity `displayField` in the unified `EntitySettingsDialog`). What remains is the **verbose multi-field mode** + the field-subset picker.

High priority, user-requested (lightroom-style scanning). **Open questions:** per-type persistent default vs. per-session; verbose layout (key/value rows vs. mini-table vs. chips); how many fields before lists get noisy/slow — cap or virtualize?

> 🪧 **Reuse the freed second tile slot.** `GridItem.secondaryLabel` exists but is **unused on the Files side** (records use it for the subtitle). It's the natural mechanism for this item's compact per-tile metadata — wire the field-subset picker to populate `secondaryLabel`/a sibling meta line rather than inventing a new tile region. Item 9 (Sorting) deliberately left this slot free: it surfaces the last-modified timestamp **in the side panel, not the tile**, so the grid stays clean until this configurable-display work lands here.

## Cluster: Asset pipeline & deps

Thumbnails, masonry layout, and the unused-dependency decisions. **Design the resize pipeline once** — Items 7, 15, 23, 34, 35 all touch it.

### 15 · Image Compression Management

```yaml
status: blocked
size: M
usefulness: 2
priority: low
files: [src/lib/server/fileMetadata.ts, src/lib/storage/settingsFile.ts]
depends_on: []
open_questions: 1
acceptance:
  - Per-media-type compression setting (quality/target size)
  - On upload/modify, generate a compressed variant and record both paths
  - UI to choose original vs. compressed per record (or per export)
```

Manage compressed variants (via `sharp`). **Open question (blocks):** strong overlap with Item 7's asset-volume concerns (thumbnails, selective export) and Items 34/35 — decide the **one** resize pipeline before building two parallel ones. Explicitly non-urgent.

### 34 · Reimplement masonry grid layout

```yaml
status: ready
size: M
usefulness: 2
priority: low
files: [src/lib/components/data-grid/DataGrid.svelte, src/lib/components/data-grid/types.ts]
depends_on: []
open_questions: 0
acceptance:
  - Variable-height tiles packed without the dead space the fixed grid leaves
  - Wired into DataGrid behind the existing GridSize control (both files hub + record views inherit it)
  - Preserves the side-agnostic GridItem contract (incl. the reserved `secondaryLabel`)
```

`@masonry-grid/svelte` is a kept-but-unused dependency (retained deliberately, 2026-06-21). Visual polish only. **Decided (not blocking):** pick `@masonry-grid/svelte` vs. CSS `columns` vs. a small JS packer at implementation time — it's an implementation detail, not a product question. Masonry applies to the **tile grid** (files hub), not the records-native vertical list (`RecordListColumn`).

### 35 · Remove (or actually use) the `sharp` dependency

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [package.json, src/lib/server/fileMetadata.ts]
depends_on: []
open_questions: 0
acceptance:
  - EITHER remove `sharp` from package.json (confirm nothing in build/scripts pulls it in)
  - OR adopt it for server-side thumbnail generation (pairs with Items 15/34)
```

`sharp` is declared but **unreferenced in `src/`** (upload uses `heic-convert`, EXIF uses `exiftool-vendored`). Heavy native dep carried unused. Dependency hygiene — low direct user value, but decide one way or the other rather than leaving it dangling.

---

## Cluster: Bulk & schema utilities

Mostly shipped during the records work — small remainders to close out.

### 3 · Bulk Operations — bulk-export remainder

```yaml
status: ready
size: S
usefulness: 1
priority: low
files: [src/lib/components/RecordBulkActions.svelte, src/routes/api/media-types/[typeId]/records/bulk-update, src/routes/api/media-types/[typeId]/records/bulk-delete]
depends_on: []
open_questions: 0
acceptance:
  - Bulk-export selected records as JSON (the only remaining bulk action)
```

> ✅ **Mostly shipped.** Bulk-**update** a field and bulk-**delete** across selected records both exist ([`RecordBulkActions.svelte`](../src/lib/components/RecordBulkActions.svelte) + the `bulk-update`/`bulk-delete` endpoints). Only **bulk-export to JSON** remains — demoted from a full item to this one-liner.

### 5 · Data Validation & Repair — verify coverage

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/routes/api/media-types/[typeId]/records/repair/+server.ts, src/lib/storage/jsonRepo.ts]
depends_on: []
open_questions: 0
acceptance:
  - Confirm the existing `repairRecords(dryRun)` covers orphan-key removal + type coercion + a report
  - Extend only the gaps; close the item otherwise
```

> ✅ **Partially shipped.** A records [`repair` endpoint](../src/routes/api/media-types/[typeId]/records/repair/+server.ts) already exists with `repairRecords(dryRun)`. This is now a **verify-and-close** task: check it removes keys not in schema, coerces values to field type, and reports — extend only if a gap is found.

---

## Cluster: Integrations

External services — kept opt-in, out of the core, and out of the way.

### 37 · Import from Google Photos (Picker API)

```yaml
status: blocked
size: L
usefulness: 3
priority: medium
files: [src/routes/files/+page.svelte, src/lib/storage/classRepo.ts, src/lib/storage/manifest.ts]
depends_on: []
open_questions: 4
acceptance:
  - New googlePhotos server module (OAuth2 loopback + PKCE; Picker REST), googleConfig storage (media/google.json, chmod 600 — NEVER seed into test-fixtures/), client wrappers
  - New /api/google-photos/* routes (status, credentials, auth/start, auth/callback, session, session/[id], import)
  - GooglePhotosDialog + a "⋮ More" overflow menu next to Upload; on success call loadMeta()/loadFiles()
  - heic-convert factored into a shared helper so /upload and /import don't duplicate it
  - FEATURES.md updated (new feature row + 7 endpoints)
```

Full design: [`plans/google-photos-import.md`](plans/google-photos-import.md) + mockup [`google-photos-import.html`](google-photos-import.html). **Verdict (2026-06-22): feasible** — a picked photo collapses onto the existing upload path. **Decisions locked:** bring-your-own OAuth credentials (no Google app verification); import to All Files (unclassified); a `⋮ More` overflow menu, not a primary button (rare action). **Hard constraints** (Google 2025 API): Picker API only (no library browse/sync), can't embed (new tab + poll), ~60-min download window, ~weekly re-login.

**Open questions / research before building:** scope tier (`photospicker.mediaitems.readonly` sensitive vs. restricted); loopback OAuth port (overlaps Item 31's ephemeral-port work); partial-import resilience (`{ imported, failed }`); token-expiry UX.

### 11 · AI / External Field Enrichment

```yaml
status: discussion
size: L
usefulness: 2
priority: low
files: []
depends_on: []
open_questions: 0
acceptance:
  - (Downstream/app-specific — park or spin out of the core repo)
```

Ideas aimed at specific downstream uses (vision-API auto-fill, offline semantic search, a local vector DB over field values/EXIF), **not** the core local tool. Listed so they aren't lost. Keep the core provider-agnostic and local-first; gate any integration behind opt-in config and be explicit when data leaves the machine.

---

## Cluster: Storage & routing — design

Decisions to make **before** code. These unblock other items (esp. routing → 26/29) more than they deliver standalone value.

### 20 · File-Based Routing

```yaml
status: discussion
size: M
usefulness: 3
priority: medium
files: [src/routes/files/+page.svelte, src/routes/media/[typeId]/+page.svelte]
depends_on: []
open_questions: 2
acceptance:
  - (Design the route tree — deep-linkable per-file/per-class routes + shareable view/filter URLs)
```

Partly shipped already (the `?record=` deep link landed with the sub-app restructure). The fuller vision: per-file routes (`/media/file/[id]`), per-class routes, shareable filter URLs — so app state is addressable and bookmarkable. **Enabler:** unblocks the clean "go to file" affordance (Item 26) and the mobile drill-down (Item 29). **Open questions:** the route-tree shape; how much in-page state migrates to URLs.

### 18 · Records Storage Reorganization

```yaml
status: discussion
size: M
usefulness: 2
priority: low
files: [src/lib/storage/jsonRepo.ts, src/lib/storage/paths.ts]
depends_on: []
open_questions: 3
acceptance:
  - (Decide the json-side layout before moving any files)
```

Parallel to the file-first `media/` reorg: move the `json`-kind side under a top-level `records/` folder (record files + `records/settings.json`). Internal layout change, low direct user value. **Now revisitable** since the classes layout is settled. **Open questions:** how `globals` fits; whether each json "type" is a subfolder; what lives in `records/settings.json` vs. per-type; migration from today's top-level per-type folders.

### 19 · Per-Class "Should / Shouldn't Be Here" Review (excludedFiles successor)

```yaml
status: discussion
size: M
usefulness: 2
priority: low
files: [src/lib/storage/classRepo.ts, src/lib/storage/manifest.ts]
depends_on: []
open_questions: 0
acceptance:
  - Per class, mark a file "dismissed / not-relevant" so it stops surfacing as a candidate (per-class, never a global hide)
  - A triage view: for a class, show candidate files (unclassified / heuristic) and quick add-to-class or dismiss
  - Dismissals stored in the class JSON (source of truth), optionally mirrored into the manifest index
```

The file-first redesign removed per-class `excludedFiles` (membership is opt-in). This reintroduces the **useful** half — triage — without the opt-out burden. `discussion` because it's a design idea (the value/shape isn't confirmed), even though the mechanics are clear. Keep distinct from delete-from-disk (global) and remove-from-class (drops membership).

### 16 · Open Design Questions

```yaml
status: discussion
size: S
usefulness: 1
priority: low
files: [.cursor/rules/svelte5.mdc]
depends_on: []
open_questions: 2
acceptance:
  - Decide the defaults-storage policy (explicit defaults vs. filter-for-empty)
  - Expand the Svelte 5 do/don't guidance ($bindable when appropriate vs. confusing)
```

Meta — decisions owed before related work, captured here so they're not lost.

---

## Cluster: Misc fixes & polish

Small, self-contained quality-of-life. Several name files removed in the file-first redesign — repointed below.

### 17 · Capture Nested Folder Path on Folder Upload

```yaml
status: blocked
size: M
usefulness: 3
priority: medium
files: [src/routes/files/+page.svelte, src/routes/api/files/upload/+server.ts, src/lib/storage/classRepo.ts]
depends_on: []
open_questions: 4
acceptance:
  - Folder upload preserves per-file relative paths (webkitdirectory and/or drag-drop directory traversal)
  - An upload-time "Save folder path to field" option with a field selector (existing schema fields)
  - On import, write each file's relative path into the chosen field on the created/linked record
```

> 🔧 **Stale refs repointed.** Original pointers named `ImageEditorPane.svelte` + `repo.ts` (removed). Upload now flows through [`files/+page.svelte`](../src/routes/files/+page.svelte) → [`/api/files/upload`](../src/routes/api/files/upload/+server.ts) → [`classRepo.ts`](../src/lib/storage/classRepo.ts).

User-requested; **decisions locked:** capture the relative path within the dropped folder; user picks an existing schema field per upload; relative-path-only (browser limitation). **Open questions (block):** filename collisions in the flat global store (Item 6 shipped, which helps — relative path can disambiguate); populate-only-when-empty vs. always-overwrite; remember last-used field per type; ship `webkitdirectory` input first vs. drag-drop directory support too.

### 12 · Fix / Normalize File Extension

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/lib/storage/classRepo.ts, src/lib/server/fileMetadata.ts]
depends_on: []
open_questions: 0
acceptance:
  - A per-file action to rename the extension (via the O(1) renameBlobById path — references stay intact)
  - Optionally detect the true type (magic bytes) and suggest the correct extension
```

> 🔧 **Stale ref repointed + simplified by Item 6.** The old `propagateFilenameRename` fan-out is gone — rename is now O(1) via `renameBlobById` ([`classRepo.ts`](../src/lib/storage/classRepo.ts)/[`manifest.ts`](../src/lib/storage/manifest.ts)). Since identity is decoupled from filename, an extension fix is a pure display-name change. `fileMetadata.ts` already sniffs magic bytes — reuse it for type detection.

### 13 · Swap Width/Height (orientation fix)

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/lib/components/FileEditorPanel.svelte, src/lib/storage/classRepo.ts]
depends_on: []
open_questions: 0
acceptance:
  - A per-record action to swap the stored width and height values
  - Optionally a heuristic warning when stored dims look inconsistent with the decoded image, offering the swap
```

Stored `width`/`height` (written on upload) can end up transposed for some EXIF-oriented images. Niche bug-fix. The heuristic-warning half would lean on `sharp` (see Item 35) — but the manual swap action needs no new dep, so this is `ready`.

### 29 · Records Explorer — Mobile / Narrow Drill-Down

```yaml
status: ready
size: M
usefulness: 2
priority: low
files: [src/lib/components/records/RecordsRail.svelte, src/routes/media/[typeId]/+page.svelte, src/lib/hooks/is-mobile.svelte.ts]
depends_on: []
open_questions: 0
acceptance:
  - On narrow viewports, show one pane at a time (rail → list → detail) with back navigation, reusing the is-mobile hook
  - Decide whether the rail becomes a top type-switcher or an offcanvas drawer on mobile
```

The Records Explorer ships as a desktop three-pane layout; three columns don't fit on narrow viewports. Sequences naturally with Item 20 (per-pane URLs make back/forward fall out of routing) but doesn't strictly need it.

---

## Shipped & folded

Archive — kept as tombstones so cross-references and the triage board resolve. **Authoritative status lives in [`FEATURES.md`](FEATURES.md).** Do not re-litigate these here.

| # | Item | Disposition |
| --- | --- | --- |
| 1 | File Field Picker UI | ✅ **Shipped** — `FilePicker` over the global blob store (search + thumbnails), stores the chosen blob id. |
| 2 | Missing File Indicators (API + UI) | ✅ **Shipped** — flagged end-to-end (`missing_file_fields` / `_missing_files`); grid badges + inline editor warnings. |
| 6 | Stable File IDs | ✅ **Shipped (Option 3)** — manifest UUIDs, O(1) rename, lazy-heal. Foundational for Items 7/12/17. See `STABLE_FILE_IDS.md`. |
| 22 | Group-by across multiple classes ("all of" view) | ✅ **Shipped** — Group-by lists one `(class, field)` per intersected class; `listAllFiles` takes `groupBy`. |
| 28 | Per-Type / Per-Class Icon Picker | ✅ **Shipped** — curated Lucide set in the unified `EntitySettingsDialog`; rendered on rails, breadcrumb, palette, grid chips. |
| 9 | Sorting & Ordering | ✅ **Shipped** — shared `SortControl` + `core/sort.ts` comparator (empties-last, stable tie-break); `?sort&dir` on records `list` / `/api/files` / class `members`; persisted per-entity (type `settings.json` · class `config` · `media/settings.json`). Folded in: last-modified shown in the side panels (`core/datetime.ts`). |
| 10 | Filter for Missing / Empty Fields | ✅ **Shipped** — rail "Show" group (`EmptyFieldFilter`): "Incomplete only" (any empty user field) + per-field "is empty"; on Records + single-class Files catalog. One shared empty predicate (`core/filters.ts` `isEmptyValue`/`recordHasEmptyField`); `?incomplete` on records `list` / class `members`, per-field via `?filters`. Transient (not persisted). Complements Item 2 (missing **file** references). |
| 27 | npx Package Distribution | ➡️ **Folded into [Item 30](#30--editor-npx-setup--zero-config-root-discovery-mode-a)** — publish mechanics now live in Item 30's "Publishing (later phase)". |
