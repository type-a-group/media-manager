# Vision: `media-manager` as an npx package + host integration

> **Status:** Vision / design notes only. **No code changes** implied by this document.
> Written to be referenced and refined in future chats. See the companion diagram
> [`docs/npx-package-vision.html`](../npx-package-vision.html).

## Refined decisions (2026-06-22)

A second planning pass, grounded in a read of the current code. These supersede the
2026-06-20 notes where they overlap:

- **Quiet heal is largely already implemented.** The earlier note assumed `reconcile`
  "always rewrites." It does not — `reconcile` (`manifest.ts`) writes only `if (changed)`,
  and so do `setClassMembership` / `removeClassFromIndex` / `applyMembershipIndex`. Pure
  browsing of unchanged committed data produces **zero writes** from those paths today.
  Two residuals remain: (a) the **mtime-gated resync** (`classRepo.ts: reconcileAndResync`)
  re-fires on every list after a `git` checkout/clone (git doesn't preserve mtimes), but it
  recomputes membership and skips the write when content matches — wasted CPU, **no diff**;
  (b) when a _genuine_ change happens, the whole `manifest.json` is rewritten, so any
  mismatch between the committed file's byte-format and the writer's output balloons into a
  reformat diff. **So #1 shrinks to "lock write-format stability"** (commit files in exactly
  the format the writer emits) — not a new quiet-heal code path.
- **Ephemeral port → the CLI picks a free port itself** (not adapter `PORT=0`). The CLI
  grabs a free port via `net.createServer().listen(0)`, passes that concrete value as `PORT`
  to the child server, and opens that exact URL. Deterministic, no stdout parsing, and it
  also removes today's `setTimeout(…, 2000)` open-the-browser race. (Plain `PORT=0` would
  force reading the bound port back out of the child's stdout — racier and more plumbing.)
- **Mode B stays design-only for now.** Keep refining the reader design (library-first,
  `export` as a thin wrapper; point the host static dir at `media/files/`), but **build
  nothing** until nicb.at's render needs are concrete. The root-threading refactor (#5) is
  the gating work and is explicitly deferred.

## Decisions so far (2026-06-20)

Captured from a planning chat — these steer the sequencing, not yet committed to code:

- **Editor-first.** Nail `npx media-manager` zero-config root discovery (Mode A) before
  the host-reader work. The reader (Mode B) stays designed-but-deferred.
- **Workspace is committed to git** in nicb.at. The editor lazy-heals the manifest on
  every list and can rename/strip blobs, so _just opening_ committed data can dirty the
  tree. **Chosen fix: "quiet heal" — persist heal results to disk ONLY when something
  actually changed** (new/missing blob); suppress no-op rewrites (mtime/formatting churn).
  Editing stays fully functional; you simply stop getting spurious diffs from browsing.
  This is a targeted change to `reconcile`'s write logic, _not_ a separate read-only mode.
  (A hard `--read-only` flag is **not** being pursued now.)
- **Distribution: local dep now, publish/global-link later.** media-manager goes into
  nicb.at as a devDependency (`file:../media-manager` or a git URL); `npx media-manager`
  inside nicb.at then resolves the **local** install — no npm publish, stays private, bare
  command works. Publishing scoped (`@nicbat/media-manager`) or `npm link` is a _later_
  option, not now.
- **Config: standalone `media-manager.config.json`** at the host repo root (not a
  `package.json` key). **But see the serve-model rethink below — `port` likely drops out
  of it.**
- **Serve model: keep the server, drop the fixed port.** A server is mandatory (the app
  does real filesystem IO, exiftool, heic-convert, manifest locks — it cannot be a static
  page). What's _not_ needed is a configured port: bind to an **ephemeral port (port 0)**
  and auto-open the OS-assigned URL, eliminating port config + collisions with the host
  dev server. A desktop-window shell (Tauri/Electron) is a possible _later_ polish, not now.
- **Dependency / install-size work: deferred entirely.** Leave `sharp`,
  `@masonry-grid/svelte`, and `exiftool-vendored` as-is for now; revisit only if cold
  `npx` install time actually annoys.
- **Host consumption shape (Mode B): undecided** — library vs `export` JSON, left open
  until nicb.at's needs are concrete. Don't over-build Mode B yet.
- **Serving the blob bytes (Mode B): undecided** — point-at-`media/files` vs copy-into-build.

### What "editor-first + committed" implies for near-term work

1. **Root discovery chain** (steps 3–5 below) — the headline `npx` experience.
2. **`media-manager.config.json`** at the nicb.at repo root pointing at
   `src/assets/media_manager` (root path only; **no `port`** — ephemeral).
3. **Write-format stability** (was "quiet heal") — `reconcile` already persists only on
   real change; commit files in the writer's exact byte-format so the occasional real write
   produces a minimal diff, not a whole-file reformat.
4. **Ephemeral port + auto-open** — the **CLI picks a free port** (`net …listen(0)`), passes
   it as `PORT` to the child, and opens that exact URL (also removes the 2s open race).
5. **Local-dep wiring** — add media-manager to nicb.at's `package.json` so `npx
media-manager` resolves the local install.

## The dream, in one sentence

From inside another repo (e.g. `~/Projects/nicb.at`, whose media lives at
`src/assets/media_manager`), run **`npx media-manager`** and have it (a) launch the
editor pointed at the right folder with **zero config**, and (b) expose a small,
**read-only** way for that host project to consume the on-disk format at build time.

## Two integration modes (keep them separate)

The single biggest design clarification: there are **two different things** the host
wants from media-manager, and they have opposite constraints.

| Mode          | Entry point                                           | Mutates the root?                                           | Audience                                                  |
| ------------- | ----------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| **A. Editor** | `npx media-manager` (boots the Node server + browser) | **Yes** — heals manifest, renames blobs, writes class files | You, interactively curating metadata                      |
| **B. Reader** | `import` a library / `media-manager export`           | **No** — pure reads                                         | The host build (nicb.at) rendering galleries, pages, etc. |

Conflating these is the trap. The editor is allowed to rewrite the root (it lazy-heals
the manifest, can rename/strip blob refs — see `CLAUDE.md` "lazy-heals"). If the host's
data root is **committed to git**, simply _launching the editor_ can produce diffs. The
reader must be a clean, side-effect-free path with a frozen contract.

---

## Mode A — `npx media-manager` with zero-config root discovery

### Today

`bin/media-manager.js` **requires** a positional `<root-dir>` and errors without it. It
also requires `build/` to already exist next to the bin. Good foundation, not yet
zero-config.

### Target behavior

Running bare `npx media-manager` inside a host repo should resolve the root through a
clear precedence chain (first match wins):

1. **Explicit arg** — `media-manager ./some/root` (current behavior; always wins).
2. **Env** — `MEDIA_MANAGER_ROOT` (current behavior).
3. **Config file** — nearest `media-manager.config.json` / `.media-managerrc` found by
   walking up from `cwd`, **or** a `"mediaManager"` key in the nearest `package.json`.
4. **Convention auto-detect** — walk up from `cwd` looking for a folder that _looks like_
   a workspace: contains `media/manifest.json` (strongest signal) or a `media/` dir.
   Probe common spots: `./media_manager`, `./src/assets/media_manager`, `./media`,
   `./.media-manager`.
5. **Fallback** — friendly error that prints the chain it tried, plus
   `media-manager init` to scaffold one (see CLI verbs below).

For nicb.at the clean answer is a committed **`media-manager.config.json`** at the repo
root:

```jsonc
{
	"root": "src/assets/media_manager",
	// no "port" — the server binds to an ephemeral port (port 0) and auto-opens
	// the OS-assigned URL, so it can never collide with the host dev server.
	"open": true,
	"bodySizeLimit": 104857600
}
```

…then `npx media-manager` from anywhere in the repo "just works."

### CLI evolves from positional-only to verbs

Keep the bare/positional form for back-compat, but grow a verb surface:

| Command                       | Purpose                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `media-manager` (no args)     | Discover root → **serve** (the headline)                                                   |
| `media-manager serve [root]`  | Explicit serve                                                                             |
| `media-manager init [root]`   | Scaffold an empty workspace (`media/`, `manifest.json`, `settings.json`)                   |
| `media-manager export …`      | **Mode B** — emit denormalized JSON (see below)                                            |
| `media-manager doctor [root]` | Validate / heal / report without serving (surface the `healed`/`missing` info as a report) |

### Packaging gotchas (the part that actually bites on `npx`)

- **`build/` must ship.** It already does (`package.json#files`), and `prepublishOnly`
  runs the build. Verify it isn't excluded by `.gitignore`-driven publish surprises.
- **Native/heavy deps inflate cold `npx` downloads.** `npx` fetches the whole tarball on
  a cold cache every run. Current `dependencies` include `sharp` and
  `@masonry-grid/svelte`, which `CLAUDE.md` says are **unreferenced in `src/`** — drop
  them to shrink installs. `exiftool-vendored` bundles platform Perl binaries (tens of
  MB) — the big contributor; consider making EXIF an **optional/lazy** feature so the
  base install is small and exiftool is only pulled when needed.
- **Name collision.** `media-manager` is likely taken on npm → publish scoped
  (`@nicbat/media-manager`) and document `npx @nicbat/media-manager`. (Local dev can use
  `npm link` to get the bare `media-manager` bin without publishing.)
- **Add `engines.node`.** Pin a supported Node range so `npx` fails loudly, not weirdly.
- **Editor-mutates-root warning.** When the resolved root is inside a git repo with a
  dirty/clean tree, consider printing a one-line "heads up: editing may modify files
  under `<root>`" so committed-data surprises are expected.

---

## Mode B — host ↔ file-format library + scripts

This is what lets nicb.at _render_ from the data without booting the editor.

### The shape of a public reader

A subpath export, e.g. `media-manager/fs`, exposing **pure, root-explicit, read-only**
functions. Crucially it must take the root as an **argument**, not via
`process.env.MEDIA_MANAGER_ROOT` (today the storage layer reads the env global — a
library API that mutates `process.env` is hostile to a host build).

```ts
import { openWorkspace } from 'media-manager/fs';

const ws = openWorkspace('src/assets/media_manager');

await ws.listFiles({ classIds: ['photos'], match: 'any' }); // FileItem[]
await ws.listClasses(); // class configs + counts
await ws.listMembers('photos'); // catalog rows for one class
await ws.getFileMeta(id); // per-blob metadata
ws.resolveBlobPath(id); // absolute path to the file on disk
await ws.listJsonRecords('notes'); // json-type records
await ws.getGlobals(); // the globals singleton
```

Implementation note: this should **reuse the existing read paths** (`classRepo.ts`,
`manifest.ts`, `jsonRepo.ts`) rather than re-parse the format — but those currently
resolve the root from `getRootDir()` (env). The refactor is to thread an explicit root
through (or instantiate a repo bound to a root). Re-export the **Zod DTOs** from
`src/lib/core/types.ts` (`FileItem`, `ClassFile`, …) so the host gets typed, validated
data and a frozen contract.

**Guarantees the reader must make:** never write, never heal, never lock-then-rename.
If the manifest is stale vs disk, the reader reports it (like `healed`/`missing`) but
does not "fix" it. Healing stays a Mode-A (editor) responsibility.

### For non-Node hosts: `media-manager export`

Not every host wants to `import` Node code at build (Astro/Vite islands, static
pipelines, other languages). A CLI export emits a single denormalized JSON blob:

```bash
media-manager export --class photos --out photos.json
media-manager export --type notes
media-manager export --all > workspace.json
```

Output is a stable, self-contained snapshot (records joined to their filenames/paths)
the host reads with plain `fs.readFile` + `JSON.parse`.

### Wiring the actual asset files into the host build

The metadata is JSON, but the **blobs live in `media/files/`**. The host needs those
bytes in its output. Two patterns to document/support:

1. **Point the host's asset/static dir at `media/files/`** (or a symlink), and reference
   blobs by their manifest filename. Simplest; no copy step.
2. **Export-then-copy**: the `export`/a helper resolves the set of blobs a view needs and
   copies (or hardlinks) them into the host's `public/`/`dist/`. Better for pruning
   unused assets and for content-hashed pipelines.

`resolveBlobPath(id)` (reader) is the primitive both patterns build on.

---

## Open questions to resolve in a future chat

**Resolved (2026-06-20):**

- Editor-first sequencing.
- Committed-data friction → **quiet heal** (persist only on real change); no hard
  read-only mode for now.
- Distribution → **local dep** in nicb.at now; publish/`npm link` later.
- Config → standalone **`media-manager.config.json`** (root path only).
- Serve model → **ephemeral port + auto-open**; keep the server; desktop shell deferred.
- Dependency/bundle work → **deferred entirely**.

**Resolved (2026-06-22):**

- Quiet heal → already write-guarded; #1 reduces to **write-format stability** (commit
  files in the writer's exact byte-format), not a new code path.
- Ephemeral port → **CLI picks a free port itself** and opens that exact URL (not `PORT=0`).
- Mode B → **design-only**; build nothing yet. Reader is library-first with `export` as a
  thin wrapper; host static dir points at `media/files/` (pattern 1).

Still open:

1. **Host consumption shape** _(deferred — Mode B, design-only)_ — confirmed
   library-first (`media-manager/fs`) with `export` as a thin wrapper, but unbuilt until
   nicb.at's build needs are concrete.
2. **Blob-serving strategy** _(deferred — Mode B)_ — start with pattern 1 (host asset dir →
   `media/files/`); copy/content-hash pipeline (pattern 2) only if pruning matters.
3. **Reader root-threading refactor** _(deferred — gates Mode B)_ — thread an explicit
   `WorkspacePaths` struct through the read paths; keep env-reading `getRootDir()` as the
   Mode-A default factory. The real meat, deliberately not started.
4. **Desktop-window shell** _(someday)_ — Tauri/Electron/`webview` wrapper instead of a
   browser tab, if the localhost-tab feel ever bothers you.
5. **Bundle/deps** _(deferred)_ — drop unused `sharp`/`@masonry-grid/svelte`; consider
   lazy `exiftool-vendored`. Revisit only if cold `npx` install time annoys.

## Concrete nicb.at end-state (north star)

```
~/Projects/nicb.at/
├─ media-manager.config.json          # { root: "src/assets/media_manager" } — no port (ephemeral)
├─ src/assets/media_manager/          # the workspace (committed)
│  └─ media/{manifest.json, files/, classes/, settings.json}
└─ src/lib/media.ts                   # imports media-manager/fs, renders galleries at build
```

- **Curate:** `npx media-manager` from the repo → editor opens on the right folder.
- **Build:** the site imports `media-manager/fs` (or reads a `media-manager export`
  snapshot) to render from the same files it just edited.
