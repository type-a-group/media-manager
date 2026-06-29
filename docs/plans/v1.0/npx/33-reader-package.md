# Item 33 — Reader Package: Read-Only Host Integration (build-time / static)

> 1.0 npx sub-project. Backlog: [Item 33](../../../FUTURE_CHANGES.md#33--reader-package--read-only-host-integration-build-time--static). Working agreement: [README](../README.md#how-we-build-each-feature-the-working-agreement). **Status: ready** — scope locked in the Phase-1 interview (2026-06-29). Full plan: [`reader-package-plan.html`](reader-package-plan.html).

## Backlog snapshot

```yaml
status: ready
size: L
usefulness: 3
priority: medium
files: [src/lib/reader/ (new), src/lib/core/types.ts, src/lib/core/fieldKeys.ts, package.json (exports), ~/Projects/nicb.at/src/lib/index.ts (proof, external)]
depends_on: []
open_questions: 0
```

## What & why

Let a host build (e.g. **nicb.at**) **consume the on-disk format** to render galleries / record lists **without booting the editor** — pure, read-only, layout-aware so the host never hand-codes a path that rots when the format moves. **Concrete motivation:** nicb.at's readers (`fetchImageList`/`fetchProjects`/`fetchQuotes`) still import pre-Item-18 paths while the data is now file-first — Photos/Projects/Quotes read nothing. The reader kills exactly that silent breakage.

## The framing correction (vs. the original stub)

The old stub centred on an **`fs`-based "root-threading refactor"** (`openWorkspace(root)`). Investigating nicb.at showed the target host consumes via **Vite bundle**, not `fs`: it reads JSON through `import.meta.glob`/`import()` and resolves image URLs through **Vite's asset pipeline** (hashed). There is no `fs`/root/`process.env` at runtime. So the reader core is **pure functions over already-parsed JSON**, and root-threading demotes to Item 7's separate `fs`/export-CLI face.

Three reader shapes the old plan conflated: **(a)** `fs` `openWorkspace(root)` → Item 7 / live server; **(b)** Vite-bundle library → **this item (v1)**; **(c)** runtime HTTP client → deferred (a host running MM live).

## Scope locked (Phase 1, 2026-06-29)

- **Mode:** build-time / static only (Vite glob + bundled JSON, host-resolved hashed assets).
- **Scope:** data layer only — **no components** in v1 (Gallery/lightbox/cards deferred).
- **Packaging:** monorepo subpath export `media-manager/reader` (+ `/reader/vite`), sharing `src/lib/core/` so it can't drift from the editor's DTOs.
- **Purity:** environment-agnostic pure functions; no `fs`, no `process.env`, no network, no writes/heal/lock.

## The public API (facade)

```js
import { MediaManager } from 'media-manager/reader/vite';

const mm = MediaManager.load({
  data:  import.meta.glob('$assets/media_manager/**/*.json', { eager: true, import: 'default' }),
  files: import.meta.glob('$assets/media_manager/media/files/*', { eager: true, query: '?url', import: 'default' }),
});

mm.media()             // Collection<MediaItem> — every blob
mm.media('photos')     // Collection<MediaItem> — members of a class
mm.records('projects') // Collection<Record>
mm.globals()           // Record
mm.file(id)            // MediaItem | null
mm.classes(); mm.types();

mm.media('photos').where({ hidden: false }).sortBy('Year', 'desc'); // Collection: where/filter/sortBy/find/first

// items: MediaItem { id, src, filename, width, height, classes, missing, fields, field(k), file(k), files(k) }
//        Record    { id, lastModified, fields, field(k), file(k), files(k) }
```

Everything below the facade — manifest join, url/list normalization (reuse `core/`), ext-case asset matching, missing-asset handling, version guard — is **private internals**.

## Build order (Phase 3) — vertical slices

1. **33a — pure core + facade + types.** `src/lib/reader/`: private core (parse + version guard reusing `core/`, join, normalize, ext-case resolve, filter) + `MediaManager`/`Collection`/`MediaItem`/`Record`. Unit tests against a parsed fixture (no `fs`, no env). JSDoc as written.
2. **33b — Vite adapter + subpath export.** `MediaManager.load()` (two glob maps + path-based classification); `package.json` `exports` + `.d.ts`; `check`/`lint` clean.
3. **33c — documentation.** Reader README (walkthrough + per-shape recipes + migration note) + completed JSDoc — its own slice so it can't be skipped.
4. **33d — nicb.at migration (proof).** Replace the three readers via a `file:` local-dep; Photos/Projects/Quotes render from current data.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] **Purity:** runs with no `MEDIA_MANAGER_ROOT`; no `fs`/network/writes (fixture byte-identical before/after a full read sweep).
- [ ] **Join correctness:** member missing from manifest → flagged `missing` (no crash); url/list values normalize identically to the editor.
- [ ] **Asset resolution:** `foo.JPEG` ⇄ glob key `foo.jpeg`; no glob entry → `src: null` + `missing: true`, never a broken `<img>`.
- [ ] **Version guard:** non-v2 workspace → clear actionable error (names the expected layout), not an empty result.
- [ ] **File references:** `.file(key)`/`mm.file(id)` resolve to the same MediaItem identity; dangling id → `null`.
- [ ] **Docs:** reader README + JSDoc + `.d.ts` so `mm.` autocompletes; a dev reaches a rendered gallery from the README alone.
- [ ] **nicb.at proof** renders all three views from the current file-first data, no manual paths.
- [ ] `FEATURES.md` updated; Item 33 → **Shipped & folded**; triage HTML synced.
