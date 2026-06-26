# Item 33 — Reader Package: Read-Only Host Integration (Mode B)

> 1.0 npx sub-project. Backlog: [Item 33](../../../FUTURE_CHANGES.md#33--reader-package--read-only-host-integration-mode-b). Build process: [working agreement](../README.md#how-we-build-each-feature-the-working-agreement). **Status: discussion** — the consumption face is genuinely open. **Decide the shape before building; this lands last.**

## Backlog snapshot

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

## What & why

The **reader** half (Mode B): let a host build (e.g. nicb.at) **consume the on-disk format** to render galleries **without booting the editor** — pure read-only. **Deferred** until nicb.at's build needs are concrete, so the consumption *shape* stays open. Overlaps the deferred static-export (Item 7) — both are the read face of the same logic.

## The one piece worth scoping early (Phase 1/2)

The **root-threading refactor** — today the storage layer reads the root from `process.env.MEDIA_MANAGER_ROOT` ([`paths.ts`](../../../../src/lib/storage/paths.ts)); a library/read API must take an **explicit root** instead, and must **never write/heal/lock**. This refactor is shared with Item 7 and is the safe, high-value thing to do even before the face is decided. Item 32 (quiet heal) reduces the heal-on-read surface this has to avoid.

## Open questions to resolve in the interview (Phase 1) — REQUIRED before building the face

1. **Library vs. export face** — a subpath export `media-manager/fs` with `openWorkspace(root)` etc. (host imports + reads live), **or** an export CLI that emits a denormalized JSON snapshot? (Don't pre-build either; this is *the* decision.)
2. **Blob-serving strategy** — point a static dir at `media/files/` vs. copy/hardlink only referenced blobs.
3. **On-disk format versioning** — how the reader tolerates older/newer roots.

If nicb.at's needs still aren't concrete at interview time, the right 1.0 outcome is: **ship the root-threading refactor only** (it's pure upside), and keep the consumption face deferred. Record that explicitly.

## Build notes (Phase 3)

- **Step 1 (do regardless):** thread an explicit `root` through `paths.ts` and the repos, so read paths don't depend on `process.env` mutation and never write/heal/lock. Keep the existing env-based path working for the editor (Mode A) — add the explicit-root entry points alongside.
- **Step 2 (only after the face is decided):** build either the subpath library export or the snapshot export CLI per the interview; reuse the read layer (no duplicated read logic — same rule as Item 7's export).
- Coordinate with Item 7 (static export) and Item 20 (routing) — design the read/asset pipeline once.

## Verification stages (Phase 4)

- [ ] Decision recorded: library-vs-export face, or explicit **defer-the-face / ship-refactor-only**.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — read functions work against an **explicit root** with **no `process.env.MEDIA_MANAGER_ROOT` set**, and provably perform **no writes** (assert the data root is byte-identical before/after a full read sweep — the read-only guarantee).
- [ ] If a face shipped: a host-side smoke test (import the library / consume the snapshot) renders a gallery from a fixture root without booting the editor.
- [ ] Editor (Mode A) still works unchanged through the refactor (regression).
- [ ] `FEATURES.md` updated (new read API/export surface); Item 33 → **Shipped & folded** (or note the partial: refactor-only); triage HTML synced.
