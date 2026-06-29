# Plan: retire the project-local `test-ui-feature` skill

**Goal.** Drop the media-manager-specific `.claude/skills/test-ui-feature/SKILL.md` in favor of the
universal personal skill `~/.claude/skills/test-web-ui/`, **without losing** the repo-specific
knowledge the project skill currently encodes.

**Why this is safe to do.** The generic `test-web-ui` skill explicitly *discovers* how to launch an
app by reading `package.json` + `CLAUDE.md`, and defers to a project's documented testing flow when
one exists. So if the irreplaceable bits move into `CLAUDE.md`, the generic skill picks them up and
the project SKILL.md becomes redundant prose.

**What is NOT being retired.** `scripts/ui-capture.mjs` stays. The repo must remain self-contained —
a fresh clone, CI, or another contributor without the personal skill still needs a working capture
helper. Retirement targets only the **SKILL.md prose**, not the helper. (The personal skill ships
its own copy of the helper for *other* repos; this repo keeps its local one.)

## What the project skill knows that the generic one doesn't

Audit before deleting — each item must survive somewhere (almost all already live in `CLAUDE.md`):

1. The exact harness: `npm run test:serve -- --no-open` (builds if `build/` missing, copies
   `test-fixtures/` → gitignored `test-data/`, serves on :3000). — *already in `CLAUDE.md`.*
2. The **build-staleness gotcha**: `test:serve` only builds when `build/` is missing, so a `src/`
   edit is silently tested against stale code → `npm run build` (or `rm -rf build`) first. — *in
   SKILL.md §2, NOT clearly in `CLAUDE.md`; migrate.*
3. "Running the app mutates its data root → test against a throwaway copy." — *already in `CLAUDE.md`.*
4. Fixture contents (media types, the deliberately dangling `file`-reference). — *in `CLAUDE.md` +
   `test-fixtures/README.md`.*
5. **Cleanup gotcha**: the `serve-test.mjs → media-manager.js → node build` tree leaves `node build`
   orphaned on :3000 (next run → `EADDRINUSE`); kill by **port**, not `pkill -f`. — *SKILL.md §5
   only; migrate.*
6. **Selector quirks**: Svelte binds input value as the DOM property not the attribute
   (`input[value=…]` won't match); truncated grid labels vs. full sidebar names; headless renders
   light theme. — *SKILL.md §4; (1) is generic and already in the personal skill, the
   grid/sidebar one is app-specific; migrate that one.*

Items 2, 5, and the grid/sidebar selector tip are the only genuinely at-risk knowledge.

## Steps

1. **Migrate the at-risk knowledge into `CLAUDE.md`** — extend the existing "Testing features in the
   built app (manual)" section (currently `CLAUDE.md` ~L30–52) with: the build-staleness rule (#2),
   the kill-by-port cleanup snippet (#5), and the grid-label-vs-sidebar selector tip (#6). Keep it
   tight — this section already covers the harness and the mutates-data-root warning.
2. **Repoint the doc references** that name the skill, so they don't dangle:
   - `plans/subapp-restructure.md:17`, `docs/plans/v1.0/09-sorting.md:45`,
     `docs/archive/*` (globals-redesign, unify-files-records, entity-settings) — these are historical
     plan docs; either leave as-is (archive is frozen history) or s/`test-ui-feature`/`test-web-ui`/.
     **Decision:** leave `docs/archive/*` untouched (frozen); update the live `plans/` ones.
   - `scripts/ui-capture.mjs:55` JSDoc mentions "the `test-ui-feature` skill" → reword to "the
     UI-capture flow in `CLAUDE.md`" (keep it skill-name-agnostic so it can't rot again).
3. **Remove the permission entry** `"Skill(test-ui-feature)"` from `.claude/settings.local.json`
   (and add `"Skill(test-web-ui)"` if not auto-granted).
4. **Delete** `.claude/skills/test-ui-feature/SKILL.md` (and the now-empty skill dir).
5. **Verify** the generic skill drives this app end-to-end from a cold read of `CLAUDE.md`:
   serve the fixture, run a capture via `~/.claude/skills/test-web-ui/ui-capture.mjs`, confirm a real
   screenshot + clean port shutdown. (Same smoke test already used when the personal skill was built.)

## Decision points (resolve before executing)

- **Keep or delete `scripts/ui-capture.mjs`?** — Recommend **keep** (repo self-containment; CI/other
  contributors). The duplication with the personal skill's copy is intentional and cheap.
- **Is retirement even worth it?** — The project skill is ~150 lines of mostly-still-accurate prose;
  its only cost is drift from `CLAUDE.md`. If you'd rather not migrate #2/#5/#6, the lower-effort
  alternative is to **keep both** and just ensure the project skill's harness facts stay in sync.
  Retire only if you want a single source of truth.

## Rollback

The skill is a single committed markdown file — `git revert`/restore brings it back. No runtime
coupling, so removal can't break the app, only the agent's testing ergonomics.
