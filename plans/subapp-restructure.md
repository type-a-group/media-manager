# Plan — Sub-app restructure

Split **Globals** into its own route, add a **sub-app switcher** to the rail header, add
**breadcrumbs + deep links**, and add a **⌘K command palette**. Relation field is **deferred**
(documented in the backlog only).

Companion visual plan: [`subapp-restructure.html`](./subapp-restructure.html).

## Guiding constraints

- **No on-disk / API / media-kind change.** Globals stays a reserved `json` singleton at
  `<root>/globals/` with the `/api/media-types/globals/record` API. `test-fixtures/` is **not**
  regenerated — only the UI route where its editor renders moves.
- **shadcn-svelte for all UI** — compose `DropdownMenu`, `Command`, `Breadcrumb`; no hand-rolled markup.
- **Autosave must never trigger a list refetch** — URL writes use `replaceState`; selection sync must
  not cause the host to reload its list.
- Each phase ends with `npm run check` + `npm run lint`, then end-to-end via the `test-ui-feature` skill.

---

## Phase A — Globals → `/globals`

- **NEW** `src/routes/globals/+page.svelte` — `EntityRail` shell (switcher header) + `GlobalsEditorPane`
  in the content area. (Optional: rail body lists editor sections as jump links.)
- **EDIT** `src/routes/media/+page.svelte` — remove the `isGlobals` branch + `GlobalsEditorPane`
  import; filter `globals` out of `types`; redirect `?type=globals` → `/globals`.
- **EDIT** `src/lib/components/records/RecordsRail.svelte` — globals no longer passed in; drop the
  `t.id !== 'globals'` special-casing if it becomes dead.
- **EDIT** `src/routes/+page.svelte` — dashboard Globals card link → `/globals`.
- **Verify:** globals editor loads + autosaves at `/globals`; `/media?type=globals` redirects; globals
  gone from the Records rail.

## Phase B — Sub-app switcher

- **NEW** `src/lib/components/rail/SubAppSwitcher.svelte` — `DropdownMenu` over Files (`/files`),
  Records (`/media`), Globals (`/globals`), separator, Home (`/`). Current item checked; `goto` nav;
  icon-only trigger variant for collapsed rail.
- **EDIT** `src/lib/components/rail/EntityRail.svelte` — replace the `title` span with the switcher; add
  `current: 'files' | 'records' | 'globals'` prop (keep `title` optional); collapsed → icon trigger.
- **EDIT** the three hosts/rails to pass `current=…` instead of `title="…"`.
- **Verify:** hop Files↔Records↔Globals from the header; active checkmark; collapsed rail works.

## Phase C — Breadcrumbs + deep links

- **DEP** `npx shadcn-svelte@latest add breadcrumb`.
- **NEW** `src/lib/components/Breadcrumbs.svelte` — typed trail wrapper, reused by all hosts.
- **EDIT** `src/routes/media/+page.svelte` — `?record=` on open (`replaceState`), restore from URL on
  load, clear on close. Render breadcrumb in content header.
- **EDIT** `src/routes/files/+page.svelte` — `?file=` alongside existing `?class=`; same restore/clear.
- **Verify:** reload / share / back-forward restores the open record/file; no list flashing on autosave.

## Phase D — ⌘K command palette

- **DEP** `npx shadcn-svelte@latest add command`.
- **NEW** `src/lib/components/CommandPalette.svelte` — `Command.Dialog`; loads classes
  (`apiListClasses`) + record types (`apiListMediaTypes`, minus globals) + static entries (sub-apps,
  Home, Settings); select → `goto` deep link. v1 navigation-only.
- **EDIT** `src/routes/+layout.svelte` — mount `<CommandPalette/>` + window `keydown` for ⌘K/Ctrl-K
  (ignore while typing in inputs).
- **Verify:** ⌘K opens; jumps to a class / record type / sub-app.

## Phase E — Docs

- **EDIT** `docs/FEATURES.md` — `/globals` route, switcher, deep-link params, command palette.
- **EDIT** `CLAUDE.md` — frontend section (globals now `/globals`; switcher; palette).
- **EDIT** `docs/FUTURE_CHANGES.md` — relation/reference field idea (contrast with `file`; single vs.
  multi target; reverse "referenced by").

---

## Risks

- Deep-link URL sync vs. autosave — `replaceState` only, never refetch on autosave (patch row in place).
- ⌘K handler must not fire while typing; respect ⌘ (mac) vs Ctrl.
- All new UI must compose shadcn primitives.
