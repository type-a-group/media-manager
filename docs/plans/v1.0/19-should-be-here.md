# Item 19 — Per-Class "Should / Shouldn't Be Here" Review

> 1.0 brief. Backlog: [Item 19](../../FUTURE_CHANGES.md#19--per-class-should--shouldnt-be-here-review-excludedfiles-successor). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: discussion** — the *mechanics* are clear but the *value/shape isn't confirmed*, so the interview must lock the product shape before building.

> **🛑 DEFERRED OUT OF 1.0 — decided 2026-06-28.** Phase-1 discussion concluded the value is contingent on a candidate-*suggestion* source that doesn't exist yet. Today the only candidate stream is the existing **"Unclassified"** filter (a manual scan), so the cheap "Unclassified-only" triage is just a "reviewed, don't show again" checkmark that doesn't earn its UI surface. The genuinely useful version needs a **heuristic candidate source** (extension / EXIF / name match) — a bigger, separate suggestion-engine feature, not the `excludedFiles` successor it's framed as. **Decision: don't build for 1.0; leave in the backlog at `usefulness: 3 · priority: medium` and revisit once/if a heuristic candidate source lands.** Also noted: this item is **independent of Item 18** — 18 reorganizes the records/`json` side and explicitly leaves `media/` internals (where 19 would live) untouched, so 18 being done neither unblocks nor reshapes 19. Everything below is the original brief, retained for whenever it's picked back up.

## Backlog snapshot

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

## What & why

The file-first redesign removed per-class `excludedFiles` (membership is now opt-in). This reintroduces the **useful** half — a **triage flow** — without bringing back the opt-out burden. For a given class, show candidate files (unclassified, or matched by a heuristic) and let the user quickly **add-to-class** or **dismiss** ("not relevant to this class"). Dismissal is **per-class, never a global hide**, and lives in the class JSON (source of truth).

Keep three operations clearly distinct:
- **delete-from-disk** — global, destroys the blob (exists).
- **remove-from-class** — drops membership (exists).
- **dismiss-as-candidate** — *new*: stops a non-member from nagging as a suggestion for one class.

## Open questions to resolve in the interview (Phase 1) — REQUIRED

The backlog lists `open_questions: 0` because the mechanics are settled, but the **product shape is the real unknown** (that's why it's `discussion`). Confirm before building:

1. **Is the triage view worth it for 1.0?** What's the candidate source — purely "unclassified," or a heuristic (extension/EXIF/name match)? If heuristic, what heuristic? (No heuristic = much smaller scope.)
2. **Where does the triage view live** — a mode in the class catalog view, a tab in `EntitySettingsDialog`, or a dedicated panel?
3. **Dismissal storage** — confirm class-JSON as source of truth + whether to mirror into `manifest.classes`-style index for fast filtering (parallels the membership index design).

If the interview concludes the value is thin, the right 1.0 outcome may be **defer** — record that decision and move it back to the backlog rather than building speculative UI.

## Build notes (Phase 3)

- Store dismissals in the class file (`classRepo.ts`), following the membership pattern; mirror into the manifest index only if needed for candidate filtering (lock order: manifest before class, as always).
- Surface "dismiss" / "add to class" as quick actions in the agreed triage surface; "Unclassified" filter already exists to seed candidates.
- Don't reintroduce a tri-state membership — dismissal is a separate per-class annotation, not an `excluded` membership state.

## Verification stages (Phase 4)

- [ ] HTML plan approved with the candidate-source + view-location decisions, or an explicit **defer** decision recorded.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] `npm run test` — dismiss persists in class JSON, hides the file from that class's candidates only, never affects other classes or membership; manifest/lock invariants hold.
- [ ] `npm run test:serve` — dismiss a candidate in one class, confirm it still appears as a candidate elsewhere and is unaffected as a member; add-to-class from triage works.
- [ ] UI capture of the triage flow (candidate → dismiss / add).
- [ ] `FEATURES.md` updated (new per-class dismissal concept + any endpoint); Item 19 → **Shipped & folded**; triage HTML synced.
