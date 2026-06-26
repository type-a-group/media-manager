# Item 30 — Editor npx Setup: Zero-Config Root Discovery (Mode A) + Publishing

> 1.0 npx sub-project. Backlog: [Item 30](../../../FUTURE_CHANGES.md#30--editor-npx-setup--zero-config-root-discovery-mode-a). Build process: [working agreement](../README.md#how-we-build-each-feature-the-working-agreement). **Status: blocked (3 OQ).** Ties the npx sub-project together. Folds in former Item 27 (publishing).

## Backlog snapshot

```yaml
status: blocked
size: L
usefulness: 4
priority: medium
files: [bin/media-manager.js, src/lib/storage/paths.ts]
depends_on: []
open_questions: 3
acceptance:
  - Bare `npx media-manager` from inside a host repo finds the workspace with zero config
  - Root-resolution precedence chain implemented (arg → env → config file → convention auto-detect → friendly error)
  - media-manager.config.json loader (parse/validate; resolve root relative to the config file, not cwd)
  - CLI grows verbs (serve default, init, doctor) while keeping the bare/positional form
```

## What & why

Today [`bin/media-manager.js`](../../../../bin/media-manager.js) **requires** an explicit `<root-dir>` and errors without it. Goal: bare `npx media-manager` inside a host repo discovers the right folder with zero config. This is the **editor** half (Mode A — the server that *mutates* the root), distinct from the reader (Item 33). Distribute as a **local dep** for now; **publishing is a later phase** (folds in former Item 27: npm `bin`/`files`/`engines` fields, prepublish build, scoped name `@nicbat/media-manager`, cross-platform native-dep audit of `exiftool-vendored`/`heic-convert`).

## Open questions to resolve in the interview (Phase 1) — REQUIRED

1. **Precedence when config file *and* env/arg are both present** — arg/env should win; confirm + document the full chain (arg → env → config file → convention auto-detect → friendly error).
2. **Auto-detect strategy** — walk **up** the tree (monorepo-friendly) vs. probe `cwd` only? Decide the convention (e.g. nearest `media-manager.config.json`, or a conventional `*/media_manager` workspace dir like nicb.at's `src/assets/media_manager`).
3. **`init` scaffolding** — reuse the app's own first-launch healing to create an empty workspace rather than hand-rolling the seed.

Plus the publishing phase: confirm it's **explicitly deferred to a later phase** within 1.0 (local-dep first), so the build doesn't block on npm packaging.

## Build notes (Phase 3)

- **Root-resolution precedence chain** in `bin/media-manager.js` + a `media-manager.config.json` loader (parse/validate; resolve `root` **relative to the config file**, not cwd — important for npx-from-subdir).
- CLI **verbs**: `serve` (default, current behaviour), `init` (scaffold empty workspace via existing healing), `doctor` (diagnose root/config — pairs with a friendly error path). Keep the bare/positional `media-manager <root>` form working.
- Depends conceptually on **31** (port) and **32** (quiet heal) being in place for a clean in-repo experience — sequence after them.
- **Publishing (later phase):** `package.json` `bin`/`files`/`engines`, prepublish build, scoped name, native-dep cross-platform audit. Don't start until local-dep flow is solid.

## Verification stages (Phase 4)

- [ ] HTML plan approved with the precedence chain + auto-detect convention + `init`/`doctor` UX decided.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] Unit/integration: precedence resolves correctly for every combination (arg / env / config-file / auto-detect / none → friendly error); config `root` resolves relative to the config file.
- [ ] Manual: from a host-repo scratch dir with a `media-manager.config.json`, bare `media-manager` finds the workspace; from a subdir too (walk-up); `init` scaffolds an empty workspace that then serves; `doctor` reports a misconfig clearly.
- [ ] Local-dep install path works (`file:` dependency from a scratch host repo).
- [ ] CLAUDE.md "Commands"/launch docs updated for the new verbs + discovery; Item 30 → **Shipped & folded** (and update the Item 27 tombstone note if publishing ships); triage HTML synced.
