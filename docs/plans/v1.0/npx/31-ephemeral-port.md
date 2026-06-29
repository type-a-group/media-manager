# Item 31 — Ephemeral Server Port + Auto-Open

> 1.0 npx sub-project. Backlog: [Item 31](../../../FUTURE_CHANGES.md#31--ephemeral-server-port--auto-open-drop-the-fixed-port). Build process: [working agreement](../README.md#how-we-build-each-feature-the-working-agreement). **Status: blocked (research spike).**

## Backlog snapshot

```yaml
status: blocked
size: M
usefulness: 3
priority: medium
files: [bin/media-manager.js]
depends_on: []
open_questions: 2
acceptance:
  - Server binds an ephemeral port (port 0 → OS-assigned) and auto-opens the actually-bound URL
  - port/PORT removed from the config surface + docs (keep an optional --port/PORT override)
  - Auto-open fires on a readiness signal, not a fixed setTimeout guess
```

## What & why

A fixed `PORT=3000` collides with the host's dev server — fatal for an npx tool run alongside a project's own server. The server itself is **mandatory** (real FS IO, `exiftool-vendored`, `heic-convert`, manifest locking — it can't be a static page), but the fixed port isn't. Bind port 0, let the OS assign, and auto-open the **actually-bound** URL on a real readiness signal.

## Open questions to resolve in the research spike (Phase 1) — REQUIRED before building

1. **The spike:** does `@sveltejs/adapter-node` accept `PORT=0` and let us **read back the bound port**? If not, fallback options: pre-bind a probe socket (race-y) or parse the adapter's "listening on" stdout line. **Resolve this first** — it shapes the whole implementation.
2. **Auto-open timing** — fire on the readiness signal once the bound port is known (not a fixed `setTimeout` guess). Determine what signal `adapter-node` gives us.

## Build notes (Phase 3)

- All in [`bin/media-manager.js`](../../../../bin/media-manager.js). Keep an optional `--port` / `PORT` override for users who want a fixed port; remove it as the *default/documented* surface.
- Auto-open the resolved `http://localhost:<bound>` URL (respect `--no-open`).
- Update CLAUDE.md + any docs that promise `PORT` default 3000.

## Verification stages (Phase 4)

- [ ] Spike write-up answering OQ 1 (can we read the bound port, and how) before building.
- [ ] `npm run check` + `npm run lint` clean.
- [ ] Manual: `node bin/media-manager.js <scratch-root>` **twice concurrently** — both start on different OS-assigned ports without collision; each auto-opens its own URL.
- [ ] Manual: with a dummy server already on 3000, the tool still starts cleanly (no fixed-port collision).
- [ ] `--port <n>` override still works; `--no-open` suppresses the browser.
- [ ] CLAUDE.md + docs updated (PORT no longer the default contract); Item 31 → **Shipped & folded**; triage HTML synced.
