# Item 12 — Fix / Normalize File Extension (+ better rename UX)

> 1.0 brief. Backlog: [Item 12](../../FUTURE_CHANGES.md#12--fix--normalize-file-extension). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready.** This brief also covers the "better renaming UI pattern" Nicholas called out alongside it.

## Backlog snapshot

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

## What & why

Since Item 6 (stable file IDs) shipped, identity is **decoupled from filename** — rename is O(1) via `renameBlobById` ([`classRepo.ts`](../../../src/lib/storage/classRepo.ts) / [`manifest.ts`](../../../src/lib/storage/manifest.ts)), and an extension fix is a pure display-name change (no fan-out). [`fileMetadata.ts`](../../../src/lib/server/fileMetadata.ts) already sniffs **magic bytes** (it does this to satisfy ExifTool), so true-type detection is reusable.

**The "+ better rename UI pattern" ask:** the current per-file rename is functional but plain. 1.0 should make renaming (full name *and* extension) a first-class, low-friction interaction in `FileEditorPanel` — this is the half of the item with the most user value and is where the interview should focus.

## Decisions to resolve in the interview (Phase 1)

- **Rename UX shape** — inline-edit the filename in the editor header? A dedicated rename affordance? Split base-name vs. extension into separate controls so an extension fix is one tap? Get Nicholas's concrete picture (this is a "what should it look like" question — mock it in the HTML plan).
- Should the app **proactively flag** an extension that disagrees with the sniffed type (a quiet badge offering "fix to `.png`"), or only offer it on demand?
- Guardrails: extension change must still pass `assertSafeBasename`/`assertSafeImageFilename`; confirm we warn (not block) when changing to an extension that disagrees with content.

## Build notes (Phase 3)

- Reuse `renameBlobById` for the actual rename; no new persistence path.
- Reuse the magic-byte sniff in `fileMetadata.ts` to compute the suggested extension; surface it as a suggestion, not an automatic mutation.
- This is the natural place to also land the improved rename interaction — keep it within `FileEditorPanel` and the shared editor chrome; don't fork a new panel.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — `classRepo` rename keeps every class membership + manifest id intact after an extension change; magic-byte → suggested-extension mapping covered.
- [ ] `npm run test:serve` — rename a file's extension and its full name; confirm references survive, the blob still serves, and the suggestion appears for a deliberately mis-extensioned fixture file.
- [ ] UI capture of the new rename interaction (before → editing → after).
- [ ] `FEATURES.md` updated if the rename/file API surface changes; Item 12 → **Shipped & folded**; triage HTML synced.
