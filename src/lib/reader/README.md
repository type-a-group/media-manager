# `media-manager/reader`

Read a [media-manager](../../../README.md) workspace from a host build — galleries, record lists,
metadata — **without running the editor**. Pure, read-only, and layout-aware: you never hand-code a
path into the workspace that breaks when media-manager's on-disk format moves.

- **Build-time / static.** Designed for a host that bundles the workspace with Vite (`import.meta.glob`)
  and resolves image URLs through its own asset pipeline (hashed, content-addressed). No server, no
  `fs`, no `process.env`, no network — just functions over already-parsed JSON.
- **One object.** Load once, then `media()` / `records()` / `globals()` / `file()`. Items are flat;
  filtering is a tiny fluent collection. The manifest join, url normalization, extension-case asset
  matching, and missing-file handling are all hidden.

> Scope: this is the **data layer** only. It does not ship UI components — you render with your own.

## Install

While unpublished, depend on it locally (a sibling checkout) or from git:

```jsonc
// host package.json
"dependencies": { "media-manager": "file:../media-manager" }
// or: "media-manager": "github:type-a-group/media-manager#v1.x"
```

The subpath ships prebuilt JS + `.d.ts` (built by `npm run build:reader`; runs automatically on
`prepublishOnly`). For a local `file:` dependency, run `npm run build:reader` in the media-manager
checkout once so `dist/reader/` exists.

## A photos gallery in ~15 lines

```svelte
<script>
	import { MediaManager } from 'media-manager/reader/vite';

	const mm = MediaManager.load({
		data: import.meta.glob('$assets/media_manager/**/*.json', { eager: true, import: 'default' }),
		files: import.meta.glob('$assets/media_manager/media/files/*', {
			eager: true,
			query: '?url',
			import: 'default'
		})
	});

	const photos = mm.media('photos').where({ hidden: false });
</script>

{#each photos as photo (photo.id)}
	<img src={photo.src} width={photo.width} height={photo.height} alt={photo.field('name')} />
{/each}
```

That's the only glue you write. `MediaManager.load` takes **two** globs — one for the JSON (parsed),
one for the asset files (`?url`, so Vite hashes + serves them). Vite requires the glob paths to be
string literals, so they live in your code; the reader figures out what each entry is (manifest /
class / record type / globals / asset) **from its path**, so this snippet is the same for every host
— only the `$assets/media_manager` prefix changes.

## The object

```js
mm.media(); // every blob in the workspace        → Collection<MediaItem>
mm.media('photos'); // members of the "photos" class       → Collection<MediaItem>
mm.records('projects'); // records of a type                   → Collection<Record>
mm.globals(); // the globals singleton                → Record | null
mm.file(id); // one blob by manifest id              → MediaItem | null
mm.classes(); // [{ id, name, icon?, count }]
mm.types(); // [{ id, name, count }]
```

## Item shapes

```ts
MediaItem {
  id: string;
  src: string | null;            // resolved hashed URL — null if the blob is missing/unresolved
  filename: string;
  width: number; height: number; // intrinsic, 0 if unknown
  classes: string[];             // membership
  missing: boolean;
  fields: Record<string, unknown>;     // class metadata (populated only in a class view)
  field(key): unknown;                 // value by key (fields first, else intrinsics)
  file(key): MediaItem | null;         // follow a file-type field
  files(key): Collection<MediaItem>;   // follow a list-of-files field
}

Record {
  id: string;
  lastModified: string | null;
  fields: Record<string, unknown>;
  field(key); file(key); files(key);   // same accessors as MediaItem
}
```

`field()` returns the **stored** value (a `url` value is normalized to `{ display_name, url }`). In a
class view (`mm.media('photos')`) `fields` holds that class's per-blob metadata; at the blob level
(`mm.media()`, `mm.file(id)`, a resolved file reference) `fields` is empty, because one blob can
belong to several classes with different metadata.

## Filtering — the `Collection`

Five chainable helpers, plus it's iterable and has `.length` / `.all`:

```js
mm.media('photos')
	.where({ hidden: false }) // field equality (AND across keys)
	.where('Year', '2024') // single field form
	.sortBy('Year', 'desc') // nullish/empty values sort last
	.filter((m) => m.width > m.height) // landscape only
	.first(); // also .find(fn)

mm.records('projects').map((r) => ({ title: r.field('name'), date: r.field('date') })); // → plain array
```

`where` / `filter` / `sortBy` return a `Collection` (chainable, never mutating); `map` returns a plain
array (you're projecting out of the collection into your own shape).

## Following file references — never juggle an id

A `file`-type field stores a raw manifest id on disk. `field()` gives you that id; `file()` / `files()`
resolve it to the actual blob — the **same** `MediaItem` you'd get from `mm.file(id)` (identity is
shared), so you get `src`, dimensions, and `missing` for free:

```js
const p = mm.records('projects').first();
p.field('thumbnail'); // → "8e6973f2-…"  (the stored id)
p.file('thumbnail'); // → MediaItem { id, src, width, height, … }
p.file('thumbnail')?.src;
p.files('gallery'); // → Collection<MediaItem>  (dangling ids dropped, never null)
```

A dangling reference yields `null` (or is dropped from `files()`), never a throw or a broken `<img>`.

## Missing files

The reader never produces a broken image: a blob whose asset isn't in your `files` glob (or is flagged
missing on disk) comes back with `src === null` and `missing === true`. Guard in your template:

```svelte
{#each mm.media('photos') as p (p.id)}
	{#if p.src}<img src={p.src} alt={p.field('name')} />{/if}
{/each}
```

## Version guard

`MediaManager.load` / `fromParsed` validates the workspace's `media/manifest.json` and throws a
`WorkspaceFormatError` if it's absent or an unsupported format version — a clear, actionable message
instead of a silently empty gallery. Catch it if you want a friendly fallback:

```js
import { WorkspaceFormatError } from 'media-manager/reader';
try {
	const mm = MediaManager.load({ data, files });
} catch (e) {
	if (e instanceof WorkspaceFormatError) {
		// workspace is stale / not migrated — show a message, run `npm run upgrade-data`
	} else throw e;
}
```

## Migrating a hand-rolled reader

If a host currently reads the workspace by hand (opening `data.json` files, globbing `files/*`,
lowercasing extensions, joining the manifest), the reader replaces all of it. Before/after:

```js
// before — manual: open photos/image-data.json, glob files/*, lowercase exts, filter hidden, build alt
export const fetchImageList = async () => {
	/* ~40 lines */
};

// after
const photos = mm
	.media('photos')
	.where({ hidden: false })
	.map((m) => ({
		src: m.src,
		width: m.width,
		height: m.height,
		alt: [m.field('name'), m.field('Location'), m.field('Year')].filter(Boolean).join(', ')
	}));
```

```js
// before — open projects/data.json, map fields, sort
export const fetchProjects = async () => {
	/* … */
};
// after
const projects = mm.records('projects').sortBy('date', 'desc');
```

A host that pinned the **pre-Item-18** paths (`photos/image-data.json`, `files/*`,
`projects/data.json`) will read nothing once the workspace is migrated to the file-first layout — that
silent breakage is exactly what the reader exists to prevent.

## Guarantees

- **Pure / read-only:** no `fs`, no `process.env`, no network, no writes. Feeding it a workspace never
  mutates it.
- **Dependency-light:** plain TypeScript; your Svelte/Vite are peers. (A future release extracts this
  to its own thin package — see FUTURE_CHANGES Item 44.)
- **Single source of truth:** value normalization and reserved-key handling mirror the editor's
  `src/lib/core/` so the reader can't drift from what the editor writes.
