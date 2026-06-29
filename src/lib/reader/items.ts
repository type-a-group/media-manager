/**
 * The two flat item types the facade hands back: {@link MediaItem} (a blob) and {@link Record} (a
 * `json` record / class metadata row). Both are read-only views with a uniform value accessor
 * (`field`) and file-reference resolvers (`file` / `files`) — so following a `file`-type field
 * never means juggling a raw manifest id, and the resolved value is the *same* MediaItem you'd get
 * from `mm.media()` or `mm.file(id)`.
 */

import { Collection, type FieldAccessible } from './collection.js';
import { normalizeFieldValue } from './values.js';

/**
 * The minimal capability the items need from the {@link MediaManager} to resolve references,
 * without importing the facade (avoids a cycle). Implemented by `MediaManager`.
 */
export interface ReaderContext {
	/** Resolve a blob by its manifest id, or `null` if the id is unknown/dangling. */
	fileById(id: string): MediaItem | null;
}

/** Intrinsic keys a {@link MediaItem} resolves from blob metadata (not class fields). */
const MEDIA_INTRINSICS = new Set([
	'id',
	'filename',
	'file_name',
	'width',
	'height',
	'missing',
	'src'
]);

/**
 * One blob (file) as surfaced by the reader: manifest identity + intrinsic info + the resolved,
 * bundler-hashed `src` URL. When obtained via a class view (`mm.media('photos')`) it also carries
 * that class's per-blob metadata in `fields`; at the blob level (`mm.media()`, `mm.file(id)`,
 * a resolved `file` reference) `fields` is empty because a blob can belong to several classes with
 * differing metadata.
 */
export class MediaItem implements FieldAccessible {
	/** Stable workspace-scoped id (the manifest key). */
	readonly id: string;
	/** Resolved asset URL (hashed by the host's bundler), or `null` when the blob is missing/unresolved. */
	readonly src: string | null;
	/** Current filename within `media/files/`. */
	readonly filename: string;
	/** Intrinsic pixel width, or `0` when unknown. */
	readonly width: number;
	/** Intrinsic pixel height, or `0` when unknown. */
	readonly height: number;
	/** Class ids this blob belongs to (membership index). */
	readonly classes: string[];
	/** True when the blob is missing from disk, or its id is dangling / its asset didn't resolve. */
	readonly missing: boolean;
	/** Class-scoped per-blob metadata (empty at the blob level). */
	readonly fields: globalThis.Record<string, unknown>;

	private readonly ctx: ReaderContext;

	constructor(init: {
		id: string;
		src: string | null;
		filename: string;
		width?: number;
		height?: number;
		classes?: string[];
		missing?: boolean;
		fields?: globalThis.Record<string, unknown>;
		ctx: ReaderContext;
	}) {
		this.id = init.id;
		this.src = init.src;
		this.filename = init.filename;
		this.width = init.width ?? 0;
		this.height = init.height ?? 0;
		this.classes = init.classes ?? [];
		this.missing = init.missing ?? false;
		this.fields = init.fields ?? {};
		this.ctx = init.ctx;
	}

	/**
	 * Read a value by key: a class field first (url-shaped values normalized), else an intrinsic
	 * (`id`/`filename`/`width`/`height`/`missing`/`src`). Returns `undefined` for unknown keys.
	 * Used directly and by `Collection.where`/`sortBy`.
	 */
	field(key: string): unknown {
		if (key in this.fields) return normalizeFieldValue(this.fields[key]);
		if (MEDIA_INTRINSICS.has(key)) {
			switch (key) {
				case 'id':
					return this.id;
				case 'filename':
				case 'file_name':
					return this.filename;
				case 'width':
					return this.width;
				case 'height':
					return this.height;
				case 'missing':
					return this.missing;
				case 'src':
					return this.src;
			}
		}
		return undefined;
	}

	/**
	 * Follow a `file`-type field to the blob it references. The stored value is a manifest id; this
	 * resolves it to a {@link MediaItem} (same identity as `mm.file(id)`), or `null` when the field
	 * is empty or the id is dangling.
	 */
	file(key: string): MediaItem | null {
		const v = this.fields[key];
		return typeof v === 'string' && v ? this.ctx.fileById(v) : null;
	}

	/**
	 * Follow a list-of-files field to its blobs, in stored order. Dangling ids are dropped (so the
	 * collection never contains `null`).
	 */
	files(key: string): Collection<MediaItem> {
		const v = this.fields[key];
		const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
		const resolved = ids
			.map((id) => this.ctx.fileById(id))
			.filter((m): m is MediaItem => m != null);
		return new Collection(resolved);
	}
}

/** Intrinsic keys a {@link Record} resolves outside its `fields` bag. */
const RECORD_INTRINSICS = new Set(['id', 'last_modified', 'lastModified']);

/**
 * One `json` record (a record-type row, or the globals singleton). `fields` holds the user-facing
 * field values (system + reserved meta keys stripped). `file`/`files` resolve `file`-type fields to
 * blobs exactly like {@link MediaItem}.
 */
export class Record implements FieldAccessible {
	/** Stable record id (UUID). */
	readonly id: string;
	/** ISO last-modified timestamp, or `null` if absent. */
	readonly lastModified: string | null;
	/** User-facing field values (system + reserved meta keys removed). */
	readonly fields: globalThis.Record<string, unknown>;

	private readonly ctx: ReaderContext;

	constructor(init: {
		id: string;
		lastModified?: string | null;
		fields: globalThis.Record<string, unknown>;
		ctx: ReaderContext;
	}) {
		this.id = init.id;
		this.lastModified = init.lastModified ?? null;
		this.fields = init.fields;
		this.ctx = init.ctx;
	}

	/**
	 * Read a value by key: a field first (url-shaped values normalized), else `id`/`lastModified`.
	 * Returns `undefined` for unknown keys.
	 */
	field(key: string): unknown {
		if (key in this.fields) return normalizeFieldValue(this.fields[key]);
		if (RECORD_INTRINSICS.has(key)) {
			if (key === 'id') return this.id;
			return this.lastModified ?? undefined;
		}
		return undefined;
	}

	/** Follow a `file`-type field to its blob (`null` when empty/dangling). See {@link MediaItem.file}. */
	file(key: string): MediaItem | null {
		const v = this.fields[key];
		return typeof v === 'string' && v ? this.ctx.fileById(v) : null;
	}

	/** Follow a list-of-files field to its blobs, in order. See {@link MediaItem.files}. */
	files(key: string): Collection<MediaItem> {
		const v = this.fields[key];
		const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
		const resolved = ids
			.map((id) => this.ctx.fileById(id))
			.filter((m): m is MediaItem => m != null);
		return new Collection(resolved);
	}
}
