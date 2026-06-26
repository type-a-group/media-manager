# Item 10 — Filter for Missing / Empty Fields

> 1.0 brief. Backlog: [Item 10](../../FUTURE_CHANGES.md#10--filter-for-missing--empty-fields). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready.**

## Backlog snapshot

```yaml
status: ready
size: M
usefulness: 3
priority: medium
files: [src/lib/core/filters.ts, src/routes/files/+page.svelte, src/lib/components/rail/EntityRail.svelte]
depends_on: []
open_questions: 0
acceptance:
  - A quick filter for records with any empty user field, or a specific empty field
  - Composes with the existing multi-clause filters; surfaced in the rail filter UI
```

## What & why

[`filters.ts`](../../../src/lib/core/filters.ts) already supports empty checks — the work is exposing them as a **first-class entry point** in the rail filter UI rather than something you can only build by hand. Two shapes: "any empty user field" (find incomplete records) and "this specific field is empty". Complements Item 2 (missing **file** references, already shipped) — that's about a referenced blob being gone; this is about a field having no value.

## Decisions to resolve in the interview (Phase 1)

- Surface as a **toggle/quick-filter** ("Incomplete only") plus a **per-field** picker, or just one of them for 1.0?
- "Empty" definition: null/undefined/`""`/empty list — confirm it matches what `filters.ts` already treats as empty so behaviour is consistent with existing clauses.
- Does it apply on the Files side (class member fields), the Records side, or both? (Acceptance implies both via the shared rail.)

## Build notes (Phase 3)

- Reuse the existing empty-check predicate in `core/filters.ts`; add a named filter entry so it shows in the rail filter UI (`EntityRail` / `RecordFilterPanel`) as a one-click clause that composes with existing multi-clause filters.
- If "any empty field" needs server support for large sets, evaluate where the existing filters run (client vs. server) and match that path — don't introduce a second filtering location.
- Surface in both rails via the shared filter components so Files and Records behave identically.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — unit coverage for the empty/missing predicate across field types (string, number, boolean, list, url, file).
- [ ] `npm run test:serve` — filter to incomplete records, and to a specific empty field; confirm it stacks with another active filter clause + search.
- [ ] UI capture of the filter in the rail (off → on, result count change).
- [ ] `FEATURES.md` updated; Item 10 → **Shipped & folded**; triage HTML synced.
