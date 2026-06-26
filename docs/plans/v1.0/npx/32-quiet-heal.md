# Item 32 — Quiet Heal (persist manifest reconcile only on real change)

> 1.0 npx sub-project. Backlog: [Item 32](../../../FUTURE_CHANGES.md#32--quiet-heal--persist-manifest-reconcile-only-on-real-change). Build process: [working agreement](../README.md#how-we-build-each-feature-the-working-agreement). **Status: blocked (3 OQ / research).** **Do this first** in the npx sub-project.

## Backlog snapshot

```yaml
status: blocked
size: M
usefulness: 4
priority: medium
files: [src/lib/storage/manifest.ts, src/lib/storage/manifest.test.ts]
depends_on: []
open_questions: 3
acceptance:
  - reconcile (and the membership-index resync) diff against on-disk state and skip the write when equivalent
  - Browsing a clean, git-committed workspace produces zero git status churn
  - healed: { added, missing } + the toast still fire for real changes
  - Unit coverage asserts "no change ⇒ no write" and "real change ⇒ write + report"
```

## What & why

Every list call lazy-heals the manifest ([`manifest.ts`](../../../../src/lib/storage/manifest.ts) `reconcile`), so **just browsing** a git-committed workspace can rewrite `media/manifest.json` (mtime/no-op churn) and dirty the tree. For an npx tool run *inside a host repo*, that's a dealbreaker. Chosen **over** a hard `--read-only` mode (which would block editing). Load-bearing path — manifest lock is taken before any class lock — so it needs tight unit coverage.

## Open questions to resolve in the interview/research (Phase 1) — REQUIRED

1. **Which write path actually churns** on a pure browse — `reconcile`, the mtime-gated membership resync, or `settings.json` healing? Audit all write paths that fire on a read-only list. (Don't assume it's only `reconcile`.)
2. **Does any caller depend on the manifest mtime advancing** every list (the mtime-gated resync uses mtime as its trigger)? If so, skipping the write must not break the resync trigger.
3. **Equivalence granularity** — structural deep-equality (safer against JSON formatting drift) vs. byte-equal JSON. Decide and justify.

## Build notes (Phase 3)

- Make `reconcile` (and the membership-index resync) **diff against on-disk state** and **skip the write** when the result is equivalent — return the same `healed: { added, missing }` report either way so the toast still fires for real changes.
- Preserve lock order (manifest before class) and the existing public contract — callers shouldn't change.
- If the mtime-gated resync trigger conflicts with not-bumping mtime (OQ 2), redesign the trigger (e.g. content hash) as part of this item, documented.

## Verification stages (Phase 4)

- [ ] Research write-up: which paths churn + the mtime-dependency answer + equivalence choice (feeds the HTML plan).
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — **the headline tests:** "no change ⇒ no write" and "real change (added/missing blob) ⇒ write + correct report"; lock order preserved; resync still fires when it should.
- [ ] `npm run test:serve` against a **git-committed** copy of `test-fixtures/`: browse every view, then `git status` — **must be clean**. Then add/remove a blob on disk and confirm the heal + report fire.
- [ ] `FEATURES.md` note on the quiet-heal behaviour; Item 32 → **Shipped & folded**; triage HTML synced.
