# Item 5 — Data Validation & Repair (verify coverage)

> 1.0 brief. Backlog: [Item 5](../../FUTURE_CHANGES.md#5--data-validation--repair--verify-coverage). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ready — verify-and-close.**

## Backlog snapshot

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/routes/api/media-types/[typeId]/records/repair/+server.ts, src/lib/storage/jsonRepo.ts]
depends_on: []
open_questions: 0
acceptance:
  - Confirm the existing repairRecords(dryRun) covers orphan-key removal + type coercion + a report
  - Extend only the gaps; close the item otherwise
```

## What & why

A records [`repair` endpoint](../../../src/routes/api/media-types/[typeId]/records/repair/+server.ts) already exists with `repairRecords(dryRun)`. This is a **verify-and-close** task, not a build-from-scratch: confirm it (a) removes keys not in the schema, (b) coerces values to their field type, and (c) reports what it changed (dry-run preview). Extend **only** where a gap is found.

## Decisions to resolve in the interview (Phase 1)

- Is repair currently reachable from the **UI**, or API-only? If 1.0 wants a user-facing "Repair / validate" action, where does it live (type settings Danger tab? a toolbar action?) and does the dry-run report get surfaced before applying?
- Should validation extend to the **Files/classes side** (per-class record repair) for 1.0, or stay Records-only? (Acceptance is Records-only.)
- Does globals (synthetic schema) need the same repair path, given the CLAUDE.md parity rule?

## Build notes (Phase 3)

- Start by reading `repairRecords` and writing/auditing tests that assert orphan-key removal, per-type coercion (string/number/boolean/list/url/file), and an accurate change report. The audit *is* the first deliverable.
- If there's no UI affordance and 1.0 wants one: a dry-run → review → apply flow, reusing the existing endpoint. Keep it explicit and confirmed (repair mutates the data root).
- Only write new code where the audit finds a gap; otherwise the deliverable is the test coverage + a one-line FEATURES note + closing the item.

## Verification stages (Phase 4)

- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — coverage proving the three acceptance behaviours (orphan removal, coercion, report) hold; add regression tests even if no code changes.
- [ ] `npm run test:serve` — run repair (dry-run then apply) against a fixture type with deliberately bad data (orphan keys, wrong-typed values); confirm the report and the result.
- [ ] UI capture if a user-facing affordance is added.
- [ ] `FEATURES.md` updated; Item 5 → **Shipped & folded**; triage HTML synced.
