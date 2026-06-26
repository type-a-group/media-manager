# media-manager 1.0 — Release Plan

The committed scope for the **1.0** release, with one self-contained brief per feature so each can be handed to its own agent. This is the *what* and the *how-we-work*; the per-feature files hold the detail pulled from [`../../FUTURE_CHANGES.md`](../../FUTURE_CHANGES.md).

- **Backlog of record:** [`docs/FUTURE_CHANGES.md`](../../FUTURE_CHANGES.md) (item numbers are immutable IDs — the filenames here use them).
- **Feature map of record:** [`docs/FEATURES.md`](../../FEATURES.md) — update it in the same change when a feature ships.
- **Triage board:** [`docs/FUTURE_CHANGES_TRIAGE.html`](../../FUTURE_CHANGES_TRIAGE.html).

> The filename of each brief is its backlog item number (e.g. `09-sorting.md` ⇒ Item 9). When a feature ships, move its backlog item to **Shipped & folded** in `FUTURE_CHANGES.md` and update `FEATURES.md` — same discipline as always.

---

## Scope

**Committed core (13).** These define 1.0.

| # | Feature | Brief | Backlog status | Size |
| --- | --- | --- | --- | --- |
| 8 | Configurable & verbose grid display | [`08-verbose-grid.md`](08-verbose-grid.md) | blocked (3 OQ) | L |
| 9 | Sorting & ordering | [`09-sorting.md`](09-sorting.md) | ready | M |
| 10 | Filter for missing / empty field | [`10-missing-filter.md`](10-missing-filter.md) | ready | M |
| 3 | Bulk operations (export remainder) | [`03-bulk-operations.md`](03-bulk-operations.md) | ready | S |
| 5 | Data validation & repair | [`05-validation-repair.md`](05-validation-repair.md) | ready | S |
| 12 | Fix / normalize file extension (+ rename UX) | [`12-fix-extension.md`](12-fix-extension.md) | ready | S |
| 13 | Swap width / height | [`13-swap-dimensions.md`](13-swap-dimensions.md) | ready | S |
| 34 | Reimplement masonry grid layout | [`34-masonry.md`](34-masonry.md) | ready | M |
| 15 | Image compression management | [`15-image-compression.md`](15-image-compression.md) | blocked (1 OQ) | M |
| 18 | Records storage reorganization | [`18-records-storage-reorg.md`](18-records-storage-reorg.md) | discussion (3 OQ) | M |
| 19 | Per-class should / shouldn't be here | [`19-should-be-here.md`](19-should-be-here.md) | discussion | M |
| 30–33 | npx package + reader (sub-project) | [`npx/README.md`](npx/README.md) | blocked / discussion | L |

**Candidates (may join 1.0).** Adjacent items that naturally sequence with the core. Not committed — promote into the table above if we decide to pull them in.

- **20 · File-based routing** — per-file/per-class routes + shareable filter URLs. Unblocks the clean "go to file" jump and mobile drill-down. Likely needed by the reader (33) anyway.
- **26 · File-field UI overhaul** — richer preview + "go to file". Pairs with 20 and with the grid work (8).
- **9-adjacent polish** — none committed beyond the table.

Everything else in `FUTURE_CHANGES.md` is **post-1.0** unless promoted here.

---

## Sequencing

Dependency-aware order. Waves can overlap across agents; within the npx sub-project, follow its own README.

1. **Wave 1 — ready quick wins (parallelizable):** 9, 10, 12, 13, 3, 5. All `ready`, no deps, small/medium. Good warm-up slices that also exercise the verification loop.
2. **Wave 2 — display & assets:** 8 (resolve its 3 open questions in the interview first), 34, 15. 8/34 both touch `DataGrid` — coordinate so they don't collide; 15 (compression) shares the **one resize/variant pipeline** with 34 and adopts `sharp` (closing the Item 35 decision) — design that pipeline once, before building either.
3. **Wave 3 — design-then-build:** 18, 19. Both are `discussion` — the interview + HTML-plan stage is where they become `ready`. Do not start code until their open questions are closed.
4. **Wave 4 — npx sub-project:** 32 → 31 → 30 → 33. Quiet-heal (32) makes browsing committed data safe; ephemeral port (31) unblocks running alongside a host dev server; root discovery + publishing (30) ties it together; the reader (33) shares the root-threading refactor and lands last. See [`npx/README.md`](npx/README.md).

---

## How we build each feature (the working agreement)

**Agile, not waterfall.** Every brief in this folder is a *starting point*, not a frozen spec. For each feature the owning agent runs the same four-phase loop, and the brief's own **Verification stages** section names the concrete gates.

### Phase 1 — Interview the developer

Before writing any code, **interview Nicholas** (the developer) to turn the brief into a shared intent. Ask, at minimum:

- **Goal** — what problem does this actually solve for him, and what does "1.0-good" look like (vs. gold-plating deferred to later)?
- **Look & behaviour** — concretely, what should the UI look like and how should it behave? Walk specific interactions, empty/loading/error states, keyboard, mobile.
- **Resolve the open questions** — every `open_questions` entry in the backlog item is a decision owed *here*. A `discussion`/`blocked` item is not ready to build until these are closed; closing them is the point of this phase.
- **Cut line** — what's explicitly out of scope for 1.0, recorded so it isn't silently re-added.

Use `AskUserQuestion` for the genuinely-forking decisions; don't ask what the code or sensible defaults already answer.

### Phase 2 — Detailed HTML plan

Produce a **standalone HTML plan** for the feature (same spirit as [`../npx-package-vision.html`](../npx-package-vision.html) and [`../../FUTURE_CHANGES_TRIAGE.html`](../../FUTURE_CHANGES_TRIAGE.html)): open-in-browser, self-contained, no build step. It captures the agreed design so the developer can review and approve **before** building. Include:

- The decided design + rationale, and the resolved open questions.
- **UI mockups** (ASCII or inline HTML/CSS) of the key states.
- **Data / API / on-disk changes** — schema, endpoints, manifest/class-file effects, migration if any.
- The **verification stages** for this feature (Phase 4), written as checkable gates.

> ⚠️ **RAWTEXT gotcha** (learned the hard way): a literal `<iframe>`/`<video>`/`<script>` inside an HTML string silently swallows everything after it. Escape them as `&lt;iframe&gt;` etc. in any note/mockup text. Verify the rendered HTML shows all sections before declaring the plan done.

Get explicit approval on the plan before Phase 3.

### Phase 3 — Build in vertical slices

Break the approved plan into the **smallest shippable slices** (a slice = a thin path end-to-end, not a horizontal layer). Build one slice at a time. Adjust the plan as you learn — that's the agile part; when reality diverges from the HTML plan, update the plan and say so, don't quietly drift.

### Phase 4 — Verification stages (explicit, every slice)

**State the verification gate before each slice and run it after.** No slice is "done" until its gate is green. The standard gates (use what applies):

- **Type & lint:** `npm run check` (svelte-check) and `npm run lint` clean for touched files.
- **Unit tests:** `npm run test` — add/extend vitest coverage for new storage/core logic (e.g. `classRepo.test.ts`, `manifest.test.ts`). Assert the new behaviour *and* a no-op/regression guard where relevant.
- **End-to-end against the fixture:** `npm run test:serve` (builds, copies `test-fixtures/` → gitignored `test-data/`, serves it) and exercise the feature in the running Node app. **Never test against a real data root** — running mutates it.
- **UI capture:** drive + screenshot/record the feature via the `test-ui-feature` skill (wraps `scripts/ui-capture.mjs` → `.screenshots/`), so the developer can see the actual states, including mid-interaction ones the URL doesn't encode.
- **Docs in the same change:** update [`docs/FEATURES.md`](../../FEATURES.md) when behaviour/routes/owning files change; update the [`test-fixtures/`](../../../test-fixtures/) seed when on-disk structure changes; move the backlog item to **Shipped & folded** in `FUTURE_CHANGES.md` and keep `FUTURE_CHANGES_TRIAGE.html` in sync.

Each feature brief restates these as a concrete, feature-specific checklist — follow that.

---

## Per-feature briefs

- [`08-verbose-grid.md`](08-verbose-grid.md)
- [`09-sorting.md`](09-sorting.md)
- [`10-missing-filter.md`](10-missing-filter.md)
- [`03-bulk-operations.md`](03-bulk-operations.md)
- [`05-validation-repair.md`](05-validation-repair.md)
- [`12-fix-extension.md`](12-fix-extension.md)
- [`13-swap-dimensions.md`](13-swap-dimensions.md)
- [`34-masonry.md`](34-masonry.md)
- [`15-image-compression.md`](15-image-compression.md)
- [`18-records-storage-reorg.md`](18-records-storage-reorg.md)
- [`19-should-be-here.md`](19-should-be-here.md)
- [`npx/README.md`](npx/README.md) — the npx package + reader sub-project (Items 30 · 31 · 32 · 33)
