# Item 18 — Records Storage Reorganization (+ other storage organization)

> 1.0 brief. Backlog: [Item 18](../../FUTURE_CHANGES.md#18--records-storage-reorganization). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: discussion (3 open questions)** — design-then-build. **Do not move any files until the layout is decided and an HTML plan is approved.**

## Backlog snapshot

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

## What & why

Parallel to the file-first `media/` reorg (which is settled): move the `json`-kind side under a top-level **`records/`** folder (record files + `records/settings.json`), instead of today's scattered top-level per-type folders. Internal layout change, **low direct user value** — its worth is consistency and a cleaner data root, and it sets up other storage tidy-ups. Nicholas grouped this with "any other storage organization," so the interview should sweep for adjacent layout cleanups to batch into one migration rather than several.

## Open questions to resolve in the interview (Phase 1) — REQUIRED before building

1. **Where `globals` fits** — it's the reserved `json` singleton; does it move under `records/` or stay top-level? (CLAUDE.md treats `globals` specially.)
2. **Per-type subfolders** — is each json "type" its own subfolder under `records/`, and what lives in `records/settings.json` vs. per-type `settings.json`?
3. **Migration** — how today's top-level per-type folders migrate (via `scripts/upgrade-data.mjs`, explicit-apply only, like the file-first migration). Backward read of old layout during transition?

Plus the "any other storage organization" sweep: catalogue any other data-root layout warts (naming, stray files, settings duplication) and decide which to fold into this single migration. **Cut line:** keep file-first `media/` untouched.

## Build notes (Phase 3)

- This is mostly `paths.ts` + `jsonRepo.ts` + a migration step. Resolution helpers in `paths.ts` (`getMediaTypePaths`/`listMediaTypeIds`) move to the new layout; `jsonRepo` reads/writes through them.
- Add an `upgrade-data` step (dry-run by default, `--apply` to write), mirroring the existing migration discipline; update `scripts/upgrade-data.mjs`.
- **Update `test-fixtures/` in the same change** (CLAUDE.md rule) — the seed must reflect the new on-disk layout, and `serve-test.mjs` keeps working.
- Because nothing user-facing changes, the risk is entirely in migration correctness and lazy-heal/lock behaviour — test those hard.

## Verification stages (Phase 4)

- [ ] HTML plan approved with all 3 open questions resolved + a before/after data-root tree + migration steps.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — `paths`/`jsonRepo` resolve the new layout; migration converts an old-layout fixture to the new one idempotently (running twice is a no-op); lock order + lazy-heal preserved.
- [ ] `npm run upgrade-data -- <scratch-root>` (dry-run) then `--apply` on a **throwaway copy**; verify the data root matches the planned tree and the app serves it.
- [ ] `npm run test:serve` against the **updated** `test-fixtures/` — Records + Globals load and edit correctly post-reorg.
- [ ] `FEATURES.md` + `test-fixtures/README.md` + `CLAUDE.md` on-disk-layout section updated; Item 18 → **Shipped & folded**; triage HTML synced.
