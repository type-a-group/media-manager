# Field labels vs. keys (+ a note on SQLite)

> **Status: discussion / parked.** Backlog: [Item 38](../FUTURE_CHANGES.md#cluster-data-model--fields). Captured from a 2026-06-28 design conversation; **no code was written.** This is the design record so we can pick it up later without re-deriving the analysis.

## The ask

While scoping bulk JSON export (Item 3), Nicholas raised a broader point: the app forces **snake_case** field keys, and he'd like a field's identifier to be **"exactly how the user types it"** — so a field typed `Release Date` isn't silently rewritten to `release_date`, and an exported JSON file reads naturally.

This is a reasonable UX goal, but it turns out to be a storage/data-model decision with real ripple effects, so we parked it rather than smuggle it into the small export task.

## How it works today

You type a field name; it's slugified to snake_case; the pretty label is **re-derived** from the key for display. The key *is* the identity. Three gates enforce this:

| Gate | File | What it does |
| --- | --- | --- |
| On-disk validation | [`src/lib/core/types.ts:323`](../../src/lib/core/types.ts) | Field keys must match `/^[a-z_][a-z0-9_]*$/` ("Field keys must be snake_case") |
| Add / rename slugify | [`SchemaEditorBody.svelte:127,224`](../../src/lib/components/schema-editor/SchemaEditorBody.svelte) | `name.trim().toLowerCase().replace(/\s+/g, '_')` before validating |
| Label derivation | [`fieldKeys.ts: fieldLabel()`](../../src/lib/core/fieldKeys.ts) | Un-snake-cases the key into a Title Case display label |

So: type **"Release Date"** → stored as **`release_date`** → shown as **"Release Date"**.

## Two ways to deliver the ask

### Option A — Free-form keys (literally what was described)

The on-disk key becomes the exact string typed: `"Release Date"`, `"Director's Cut?"`. Exported JSON keys read naturally.

**Why it's a trap — concrete problems (traced through the code):**

1. **Keys are used as identifiers in URLs.** Field keys serialize straight into query params — `searchField`, `groupByField`, `groupBy`, `sort`, `titleField`, `subtitleField` ([`src/lib/api/files.ts:69`](../../src/lib/api/files.ts), [`records/list/+server.ts:13-18`](../../src/routes/api/media-types/[typeId]/records/list/+server.ts)) — plus the `?record=` / `?type=` / `?class=` deep links. `Director's Cut?` becomes `?searchField=Director%27s%20Cut%3F`. `URLSearchParams` encodes it, but every shareable filter URL (an explicit 1.0 goal — Item 20) gets noisy and fragile.
2. **The snake_case regex is load-bearing.** `types.ts:323` is the single guarantee that a key is a safe identifier. Drop it and every consumer that assumes "a key is a simple token" (query parsing, the globals meta-maps, sort/group/filter serialization) must be audited for spaces, quotes, slashes, emoji, leading digits.
3. **System-key collisions get subtler, not safer.** Reserved keys are `id`, `last_modified`, `width`, `height`, plus `name` ([`fieldKeys.ts:10,20`](../../src/lib/core/fieldKeys.ts)). Slugification funnels `ID`/`Id`/`id` → `id` so the guard catches them; free-form makes them distinct strings, so collision logic becomes case- and whitespace-sensitive and easier to get wrong.
4. **You can't even delete the label layer.** Every existing data root is snake_case on disk → a permanent **mixed world** (old `release_date`, new `Release Date`), so `fieldLabel()` still has to prettify legacy keys. You take on all of A's fragility without getting to simplify. The only exit is a full data migration renaming every key in every record — with no clean answer when two legacy keys would normalize to the same label.
5. **A cosmetic edit becomes an O(records) write.** Renaming a field already rewrites every record ([`jsonRepo.ts:627-640`](../../src/lib/storage/jsonRepo.ts)). Under A the key *is* the label, so even fixing capitalization rewrites the whole data file. Under B it's a one-line schema edit, zero record writes.
6. **The free text spreads to more surfaces.** Globals stores per-field metadata in key-keyed JSON maps — `__field_kinds`, `__field_meta`, `__layout` ([`fieldKeys.ts:29-37`](../../src/lib/core/fieldKeys.ts)). Free-form keys leak arbitrary strings into all three.

### Option B — Stored label, stable hidden key (recommended)

Add a `label` to each schema field definition. The user types/edits the **label** freely (drop the snake_case nag in the editor); the key stays a stable, boring slug they never see. `fieldLabel()` prefers the stored label, falling back to derivation for legacy fields.

- 👍 Delivers the exact UX asked for (type whatever you want), **renaming/relabel is O(1)** (touch the schema, not records), nothing fragile leaks into URLs/JSON/meta-maps, and it's the direction the `fieldLabel()` JSDoc already flags ("Consider storing labels in schema.json instead of deriving them").
- 👎 Raw on-disk JSON keys stay snake_case — so if the goal is "exported file reads like my labels," B alone doesn't do it. **We get that for free by resolving key→label at export time** (Item 3), without paying for any of A's problems 1–6.

**The crux:** the only genuine win A has over B is "raw on-disk keys read prettily," and we get that under B at export time anyway. Recommendation: **Option B**.

### Sketch of the B work (when picked up)

- `types.ts` — add optional `label` to the field definition schema; keep the key regex.
- `SchemaEditorBody.svelte` — edit the label directly; generate/keep a stable slug key behind the scenes (collision-suffix on clash); stop showing the "must be snake_case" error.
- `fieldKeys.ts: fieldLabel()` — prefer `schema[key].label` when present, else derive (legacy path stays).
- `schemaUserFields()` — surface the stored label.
- Export (Item 3) — optional "use labels as keys" toggle that maps key→label on the way out.
- Migration / fixtures — none required for existing data (legacy keys still derive); `test-fixtures/` can gain one labelled field to exercise the path.

## Bigger picture — should this be SQLite instead of JSON-on-disk?

This conversation is a symptom of a more fundamental question Nicholas flagged: **is hand-rolled JSON-on-disk still the right substrate?** The label/key friction, the O(records) rewrites on rename, the lock-file mutex, the lazy-heal/reconcile passes, and the synthetic-schema gymnastics for globals are all things a real datastore gives you for free.

**A possible future direction: back the data root with an embedded SQLite database** (e.g. one `media.db` per root, via `better-sqlite3`).

**What it could buy us:**

- **Real schema + columns** — a field is a column (or a typed row in an EAV/JSON1 table); rename is `ALTER`/an UPDATE, not a full-file rewrite. Decoupling key from label becomes trivial.
- **Transactions** instead of the coarse `withFileLock` `.lock` mutex ([`lock.ts`](../../src/lib/storage/lock.ts), single-node only today).
- **Indexed query/sort/filter/search** server-side instead of reading the whole data file and filtering in JS ([`jsonRepo.ts`](../../src/lib/storage/jsonRepo.ts)).
- **Referential integrity** for the `file` field and the proposed `relation` field (Item 36) — dangling-ref detection becomes a join, not a manual `_missing_files` scan.
- No more lazy-heal/reconcile reconciliation passes ([`manifest.ts`](../../src/lib/storage/manifest.ts)).

**What it costs / why we haven't:**

- **Local-first, human-legible, git-diffable JSON is a deliberate product value** — the whole point of the npx/host-repo vision (Items 30–33) is that the data lives *as files in the user's repo*. A binary `.db` is opaque, doesn't diff in git, and undercuts "your data is just files you can read." This is the load-bearing objection.
- The static-site export / reader story (Item 33, Item 7) assumes readable on-disk data.
- It's a **from-scratch rewrite of the entire storage layer** (`jsonRepo`, `classRepo`, `manifest`, `paths`, the migration tooling) plus a native dependency (`better-sqlite3` — prebuilt binaries, but still native).
- Today's scale (local, single-user, hundreds–low-thousands of records) doesn't *need* a database for performance.

**Middle grounds worth considering instead of a full swap:**

- Keep JSON as the source of truth but build a **derived, throwaway SQLite index** for query/sort/search (rebuildable from the JSON at any time) — keeps the files legible, gets the query wins.
- Or just do **Option B** (a contained schema change) and revisit the substrate only if/when scale or the `relation` graph (Item 36) actually demands it.

**Recommendation:** treat SQLite as a **separate, larger architecture decision**, explicitly *not* coupled to the label/key ask. Do Option B when we want the labels; open a dedicated spike for "datastore substrate" only if the file-based model starts hurting (perf, integrity for `relation`, or multi-node). Capturing it here so the trade-off isn't lost.
