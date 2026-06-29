/**
 * `MediaManager` — the entire public surface of the reader.
 *
 * A host loads a media-manager workspace once (`MediaManager.load({ data, files })`, fed two
 * `import.meta.glob` maps) and then reads it through a handful of obvious methods — `media()`,
 * `records()`, `globals()`, `file()`, `classes()`, `types()` — getting back flat {@link MediaItem} /
 * {@link Record} items in fluent {@link Collection}s. Everything underneath (manifest join, url
 * normalization, ext-case asset matching, the version guard) is private.
 *
 * It is **pure**: no `fs`, no `process.env`, no network, no writes. All input is already-parsed JSON
 * + a `{ filename → url }` asset map; the host's bundler resolves the asset URLs.
 *
 * @see ./README.md for the walkthrough and recipes.
 */

import { Collection } from './collection.js';
import { MediaItem, Record, type ReaderContext } from './items.js';
import { parseManifest, type Manifest } from './manifest.js';

type RawRecord = globalThis.Record<string, unknown>;

/**
 * System keys stripped from a record's user-facing `fields`. Mirrors `core/fieldKeys.RESERVED_FIELD_KEYS`
 * (the editor's source of truth) — inlined so the reader stays a self-contained, zero-cross-dependency
 * module that can be lifted into its own package (FUTURE_CHANGES Item 44) by moving this directory.
 */
const SYSTEM_KEYS = new Set(['id', 'last_modified', 'width', 'height']);

/**
 * Reserved keys the globals singleton uses to emulate a schema (field kinds/meta/layout). Mirrors
 * `core/fieldKeys.GLOBALS_META_KEYS`; inlined for the same self-containment reason as {@link SYSTEM_KEYS}.
 */
const GLOBALS_META_KEYS = new Set(['__field_kinds', '__field_meta', '__layout']);

/** A class summary for rails / pickers. */
export interface ClassSummary {
	id: string;
	name: string;
	icon?: string;
	count: number;
}

/** A record-type summary for rails / pickers. */
export interface TypeSummary {
	id: string;
	name: string;
	count: number;
}

/** Internal: a parsed class file's reader view. */
interface ClassData {
	displayName: string;
	icon?: string;
	records: globalThis.Record<string, RawRecord>;
}

/** Internal: a parsed record type's reader view. */
interface TypeData {
	displayName: string;
	records: RawRecord[];
}

/**
 * Already-classified workspace input for {@link MediaManager.fromParsed}. Hosts normally use
 * {@link MediaManager.load} (which classifies glob maps for you) and never construct this directly;
 * it's the env-agnostic seam that tests and non-Vite adapters use.
 */
export interface ParsedWorkspace {
	/** Parsed `media/manifest.json`. */
	manifest: unknown;
	/** classId → parsed `media/classes/<id>.json`. */
	classes?: globalThis.Record<string, unknown>;
	/** typeId → its parsed `settings.json` + `data.json`. */
	recordTypes?: globalThis.Record<string, { settings?: unknown; data?: unknown }>;
	/** The globals singleton's parsed `settings.json` + `data.json`. */
	globals?: { settings?: unknown; data?: unknown };
	/** filename → resolved (bundler-hashed) asset URL. */
	assets?: globalThis.Record<string, string>;
}

/** The two glob maps a Vite host passes to {@link MediaManager.load}. */
export interface WorkspaceGlobs {
	/** `import.meta.glob('<root>/**\/*.json', { eager: true, import: 'default' })` — parsed JSON by path. */
	data: globalThis.Record<string, unknown>;
	/** `import.meta.glob('<root>/media/files/*', { eager: true, query: '?url', import: 'default' })`. */
	files: globalThis.Record<string, unknown>;
}

export class MediaManager implements ReaderContext {
	private readonly manifest: Manifest;
	private readonly classData: Map<string, ClassData>;
	private readonly typeData: Map<string, TypeData>;
	private readonly globalsRecordRaw: RawRecord | null;
	/** Lowercased filename → asset URL (ext-case tolerant matching). */
	private readonly assetIndex: Map<string, string>;
	/** Memoized blob-level MediaItems by id (so resolved references share identity). */
	private readonly fileCache = new Map<string, MediaItem | null>();

	private constructor(parsed: ParsedWorkspace) {
		this.manifest = parseManifest(parsed.manifest);

		this.assetIndex = new Map();
		for (const [filename, url] of Object.entries(parsed.assets ?? {})) {
			if (typeof url === 'string') this.assetIndex.set(filename.toLowerCase(), url);
		}

		this.classData = new Map();
		for (const [id, raw] of Object.entries(parsed.classes ?? {})) {
			const cf = (raw ?? {}) as {
				config?: { displayName?: string; icon?: string };
				records?: unknown;
			};
			this.classData.set(id, {
				displayName: cf.config?.displayName || id,
				icon: cf.config?.icon,
				records: (cf.records as globalThis.Record<string, RawRecord>) ?? {}
			});
		}

		this.typeData = new Map();
		for (const [typeId, parts] of Object.entries(parsed.recordTypes ?? {})) {
			const settings = (parts.settings ?? {}) as { displayName?: string };
			const data = (parts.data ?? {}) as { records?: unknown };
			this.typeData.set(typeId, {
				displayName: settings.displayName || typeId,
				records: Array.isArray(data.records) ? (data.records as RawRecord[]) : []
			});
		}

		const globalsData = (parsed.globals?.data ?? null) as { records?: unknown } | null;
		const globalsRecords = Array.isArray(globalsData?.records)
			? (globalsData!.records as RawRecord[])
			: [];
		this.globalsRecordRaw = globalsRecords[0] ?? null;
	}

	/**
	 * Build a reader from an already-classified {@link ParsedWorkspace}. Env-agnostic — used by
	 * {@link load} and by tests / custom adapters. Throws {@link import('./manifest.js').WorkspaceFormatError}
	 * if the manifest is absent or an unsupported version.
	 */
	static fromParsed(parsed: ParsedWorkspace): MediaManager {
		return new MediaManager(parsed);
	}

	/**
	 * Build a reader from two Vite glob maps. The reader infers what each entry is — manifest, class,
	 * record type, globals, or asset — **from its path**, so this is identical for every host (only
	 * the workspace path prefix changes). Non-async: pass `{ eager: true }` globs.
	 *
	 * @example
	 * const mm = MediaManager.load({
	 *   data:  import.meta.glob('$assets/mm/**\/*.json', { eager: true, import: 'default' }),
	 *   files: import.meta.glob('$assets/mm/media/files/*', { eager: true, query: '?url', import: 'default' }),
	 * });
	 */
	static load(globs: WorkspaceGlobs): MediaManager {
		return MediaManager.fromParsed(classifyGlobs(globs.data ?? {}, globs.files ?? {}));
	}

	// ── ReaderContext ──────────────────────────────────────────────────────────

	/** Resolve a filename to its hashed asset URL (ext-case tolerant), or `null` if absent. */
	private assetFor(filename: string): string | null {
		if (!filename) return null;
		return this.assetIndex.get(filename.toLowerCase()) ?? null;
	}

	/**
	 * Resolve a blob by manifest id to a blob-level {@link MediaItem} (no class fields), memoized so
	 * every reference to the same id is the same object. `null` for an unknown/dangling id.
	 */
	fileById(id: string): MediaItem | null {
		if (this.fileCache.has(id)) return this.fileCache.get(id) ?? null;
		const entry = this.manifest.files[id];
		let item: MediaItem | null = null;
		if (entry) {
			const src = this.assetFor(entry.file_name);
			item = new MediaItem({
				id,
				src,
				filename: entry.file_name,
				width: entry.width,
				height: entry.height,
				classes: entry.classes,
				missing: entry.missing || src == null,
				fields: {},
				ctx: this
			});
		}
		this.fileCache.set(id, item);
		return item;
	}

	// ── Public surface ───────────────────────────────────────────────────────────

	/**
	 * Every blob in the workspace (`mm.media()`), or the members of one class (`mm.media('photos')`).
	 * Class members carry that class's per-blob metadata in `fields`; the no-arg form returns
	 * blob-level items (empty `fields`). An unknown class id yields an empty Collection — use
	 * {@link classes} to enumerate valid ids.
	 */
	media(classId?: string): Collection<MediaItem> {
		if (classId == null) {
			const items = Object.keys(this.manifest.files)
				.map((id) => this.fileById(id))
				.filter((m): m is MediaItem => m != null);
			return new Collection(items);
		}
		const cls = this.classData.get(classId);
		if (!cls) return new Collection<MediaItem>([]);
		const items: MediaItem[] = [];
		for (const [fileId, rawRecord] of Object.entries(cls.records)) {
			const entry = this.manifest.files[fileId];
			const filename = entry?.file_name ?? '';
			const src = entry ? this.assetFor(filename) : null;
			items.push(
				new MediaItem({
					id: fileId,
					src,
					filename,
					width: entry?.width,
					height: entry?.height,
					classes: entry?.classes ?? [classId],
					missing: !entry || entry.missing || src == null,
					fields: stripSystemKeys(rawRecord),
					ctx: this
				})
			);
		}
		return new Collection(items);
	}

	/**
	 * The records of a `json` record type (`mm.records('projects')`). An unknown type id yields an
	 * empty Collection — use {@link types} to enumerate valid ids.
	 */
	records(typeId: string): Collection<Record> {
		const type = this.typeData.get(typeId);
		if (!type) return new Collection<Record>([]);
		const items = type.records.map((raw) => this.toRecord(raw));
		return new Collection(items);
	}

	/** The globals singleton as a {@link Record}, or `null` if the workspace has no globals data. */
	globals(): Record | null {
		return this.globalsRecordRaw ? this.toRecord(this.globalsRecordRaw) : null;
	}

	/** Look up one blob by its manifest id (`null` if unknown). Same item identity as {@link media}. */
	file(id: string): MediaItem | null {
		return this.fileById(id);
	}

	/** Every class with its display name, icon, and member count. */
	classes(): ClassSummary[] {
		return [...this.classData.entries()].map(([id, c]) => ({
			id,
			name: c.displayName,
			icon: c.icon,
			count: Object.keys(c.records).length
		}));
	}

	/** Every `json` record type with its display name and record count. */
	types(): TypeSummary[] {
		return [...this.typeData.entries()].map(([id, t]) => ({
			id,
			name: t.displayName,
			count: t.records.length
		}));
	}

	private toRecord(raw: RawRecord): Record {
		return new Record({
			id: typeof raw.id === 'string' ? raw.id : '',
			lastModified: typeof raw.last_modified === 'string' ? raw.last_modified : null,
			fields: stripSystemKeys(raw),
			ctx: this
		});
	}
}

/** Strip system keys (`id`/`last_modified`/`width`/`height`) and globals meta keys from a raw record. */
function stripSystemKeys(raw: RawRecord): RawRecord {
	const out: RawRecord = {};
	for (const [k, v] of Object.entries(raw)) {
		if (SYSTEM_KEYS.has(k)) continue;
		if (GLOBALS_META_KEYS.has(k)) continue;
		out[k] = v;
	}
	return out;
}

/**
 * Classify two Vite glob maps into a {@link ParsedWorkspace} by inspecting each path. Recognizes the
 * file-first layout (`media/manifest.json`, `media/classes/<id>.json`, `records/<typeId>/{settings,data}.json`,
 * `globals/{settings,data}.json`); other JSON (root/`media`/`records` settings) is ignored. Asset
 * entries are keyed by basename.
 */
function classifyGlobs(
	dataGlob: globalThis.Record<string, unknown>,
	filesGlob: globalThis.Record<string, unknown>
): ParsedWorkspace {
	const parsed: ParsedWorkspace = { manifest: undefined, classes: {}, recordTypes: {}, assets: {} };

	for (const [path, value] of Object.entries(dataGlob)) {
		const p = path.replace(/\\/g, '/');
		let m: RegExpMatchArray | null;
		if (/(^|\/)media\/manifest\.json$/.test(p)) {
			parsed.manifest = value;
		} else if ((m = p.match(/(^|\/)media\/classes\/([^/]+)\.json$/))) {
			parsed.classes![m[2]] = value;
		} else if ((m = p.match(/(^|\/)records\/([^/]+)\/data\.json$/))) {
			(parsed.recordTypes![m[2]] ??= {}).data = value;
		} else if ((m = p.match(/(^|\/)records\/([^/]+)\/settings\.json$/))) {
			(parsed.recordTypes![m[2]] ??= {}).settings = value;
		} else if (/(^|\/)globals\/data\.json$/.test(p)) {
			(parsed.globals ??= {}).data = value;
		} else if (/(^|\/)globals\/settings\.json$/.test(p)) {
			(parsed.globals ??= {}).settings = value;
		}
		// else: root/media/records settings.json — ignored.
	}

	for (const [path, url] of Object.entries(filesGlob)) {
		if (typeof url !== 'string') continue;
		const base = path.replace(/\\/g, '/').split('/').pop();
		if (base) parsed.assets![base] = url;
	}

	return parsed;
}
