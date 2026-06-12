import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { getAssetPaths, getMediaTypePaths, listMediaTypeIds, usesImageRepoKind } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import { migrateImageDataFile, migrateSchemaFile } from './migrate.js';
import { assertSafeBasename, assertSafeImageFilename } from './filenames.js';
import { normalizeFieldKey } from './migrate.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';
import {
	readMediaTypeSettingsFileSync,
	writeMediaTypeSettingsFile
} from './settingsFile.js';
import { createJsonRepoForType, type JsonRepo } from './jsonRepo.js';
import { readImageDimensions } from '$lib/server/fileMetadata.js';
import {
	readManifest,
	reconcile,
	mintFileId,
	renameFileId as manifestRenameFileId,
	removeFileId,
	type Manifest
} from './manifest.js';

import {
	SchemaFileSchema,
	type SchemaDefinition,
	type SchemaFile,
	type ImageDataFile,
	type ImageRecord,
	ImageRecordSchema,
	type ImageListItem,
	type ImageListResponse,
	normalizeUrlValue
} from '$lib/core/types.js';
import { type ImageId } from '$lib/core/ids.js';
import { hasAllowedImageExtension } from '$lib/core/images.js';
import {
	type FilterClause,
	OPERATORS,
	VALUE_LESS_OPERATORS
} from '$lib/core/filters.js';
import type { FieldType } from '$lib/core/types.js';

/**
 * Storage repository for file-backed media kinds (`images`, `generic`, `blob_store`), backed by
 * filesystem JSON catalogs plus the shared global blob store (`<root>/files/`) and its manifest.
 *
 * Identity model (post stable-file-ids):
 * - A blob's identity is its `id` in the global manifest (`<root>/files/manifest.json`), not its
 *   filename. A catalog row's primary key **is** that `id`; the filename is resolved from the
 *   manifest at read time (no denormalized copy). The same physical blob shared by many catalogs has
 *   one id, so rename is an O(1) manifest update with no cross-catalog fan-out, and an "unlinked" file
 *   is simply a manifest id that has no row in this catalog (its id never changes on link).
 *
 * Concerns / future improvements:
 * - Still a single-node filesystem implementation. A future package could accept a configurable root
 *   and alternative backends (sqlite, cloud, etc.).
 */

export type ImageRepo = ReturnType<typeof createImageRepo>;

/**
 * Paths shape expected by image repo (legacy getAssetPaths or from getMediaTypePaths).
 */
type ImageRepoPaths = {
	baseDir: string;
	imageDataPath: string;
	imagesDir: string;
	schemaPath: string;
};

function getPathsForType(typeId: string): ImageRepoPaths {
	const mp = getMediaTypePaths(typeId);
	if (mp.kind !== 'images' && mp.kind !== 'generic' && mp.kind !== 'blob_store') {
		throw new Error(`Media type ${typeId} is not a file-backed image repo kind`);
	}
	if (!mp.filesDir) throw new Error(`Media type ${typeId} missing filesDir`);
	return {
		baseDir: mp.baseDir,
		imageDataPath: mp.dataPath,
		imagesDir: mp.filesDir,
		schemaPath: mp.settingsPath
	};
}

/** Non-blob files that live in the global store dir but must never be treated as blobs. */
const NON_BLOB_NAMES = new Set(['manifest.json', 'settings.json', 'data.json', 'image-data.json']);

export function createImageRepo(typeId?: string) {
	/** Get current paths (re-reads settings so filename changes take effect). */
	function p(): ImageRepoPaths {
		if (typeId) return getPathsForType(typeId);
		const ap = getAssetPaths();
		return {
			baseDir: ap.baseDir,
			imageDataPath: ap.imageDataPath,
			imagesDir: ap.imagesDir,
			schemaPath: ap.schemaPath
		};
	}

	/** Safe filename for disk paths: image extensions unless `generic`/`blob_store` kind (any basename). */
	function assertRecordFilename(name: string): string {
		if (typeId) {
			const paths = p();
			const st = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st?.kind === 'generic' || st?.kind === 'blob_store') return assertSafeBasename(name);
		}
		return assertSafeImageFilename(name);
	}

	// Best-effort cleanup of stale lock files in dev (uses current paths). Skip when type-scoped (paths may not exist yet).
	if (!typeId) {
		(function () {
			const paths = p();
			for (const lock of [`${paths.imageDataPath}.lock`, `${paths.schemaPath}.lock`]) {
				if (fssync.existsSync(lock)) {
					try {
						const stat = fssync.statSync(lock);
						const ageMs = Date.now() - stat.mtimeMs;
						if (ageMs > 10_000) fssync.unlinkSync(lock);
					} catch {
						/* ignore */
					}
				}
			}
		})();
	}

	/**
	 * Read a JSON file, initializing it if missing.
	 *
	 * @param targetPath - The JSON file path we want to use at runtime
	 * @param fallbackPath - Optional bundled/default JSON file to seed from
	 * @param defaultValue - Fallback seed value if no bundled file exists
	 * @returns Parsed JSON value
	 */
	async function readJsonFileOrInit(
		targetPath: string,
		fallbackPath: string | null,
		defaultValue: unknown
	): Promise<unknown> {
		try {
			return await readJsonFile(targetPath);
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'ENOENT') throw err;

			let seed: unknown = defaultValue;
			if (fallbackPath && fssync.existsSync(fallbackPath)) {
				try {
					seed = await readJsonFile(fallbackPath);
				} catch {
					seed = defaultValue;
				}
			}

			await writeJsonFileAtomic(targetPath, seed);
			return seed;
		}
	}

	async function loadAndMigrateSchema(): Promise<SchemaFile> {
		if (typeId) {
			const paths = p();
			const settings = readMediaTypeSettingsFileSync(paths.baseDir);
			if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
			const { file } = migrateSchemaFile({ schema: settings.schema });
			return SchemaFileSchema.parse(file);
		}
		const paths = p();
		return await withFileLock(`${paths.schemaPath}.lock`, async () => {
			const raw = await readJsonFileOrInit(paths.schemaPath, null, { schema: {} });
			const { file, changed } = migrateSchemaFile(raw);
			if (changed) await writeJsonFileAtomic(paths.schemaPath, file);
			return SchemaFileSchema.parse(file);
		});
	}

	async function loadAndMigrateImageDataUnlocked(): Promise<ImageDataFile> {
		const paths = p();
		const raw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
		const { file, changed } = migrateImageDataFile(raw);
		if (changed) await writeJsonFileAtomic(paths.imageDataPath, file);
		return file;
	}

	async function loadAndMigrateImageData(): Promise<ImageDataFile> {
		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, loadAndMigrateImageDataUnlocked);
	}

	/**
	 * Backfill width/height for rows missing dimensions, resolving each row's blob path from the
	 * manifest (filename is no longer stored on the row).
	 */
	async function ensureImagesSyncedToFilesystem(
		schema: SchemaDefinition,
		imageData: ImageDataFile,
		manifest: Manifest
	): Promise<{ imageData: ImageDataFile; changed: boolean }> {
		void schema;
		const paths = p();
		if (!fssync.existsSync(paths.imagesDir)) {
			await fs.mkdir(paths.imagesDir, { recursive: true });
		}

		let changed = false;
		const images = await Promise.all(
			imageData.images.map(async (img) => {
				if (img.width != null && img.height != null) return img;
				const fileName = manifest.files[img.id]?.file_name;
				if (!fileName) return img;
				const filePath = path.join(paths.imagesDir, fileName);
				if (!fssync.existsSync(filePath)) return img;
				try {
					const dims = await readImageDimensions(filePath);
					if (dims.width != null || dims.height != null) {
						changed = true;
						return ImageRecordSchema.parse({
							...img,
							width: dims.width,
							height: dims.height
						});
					}
				} catch {
					// skip
				}
				return img;
			})
		);

		return { imageData: { images }, changed };
	}

	async function writeImageData(imageData: ImageDataFile): Promise<void> {
		const paths = p();
		await writeJsonFileAtomic(paths.imageDataPath, imageData);
	}

	/** Enrich an on-disk row with its resolved `file_name` (from the manifest) for the API. */
	function enrichRecord(rec: ImageRecord, manifest: Manifest): ImageRecord {
		return {
			...rec,
			file_name: manifest.files[rec.id]?.file_name ?? ''
		} as unknown as ImageRecord;
	}

	/** List item for a catalog row (id is the blob's manifest id; name resolved from manifest). */
	function toListItem(rec: ImageRecord, manifest: Manifest): ImageListItem {
		return {
			id: rec.id,
			file_name: manifest.files[rec.id]?.file_name ?? '',
			image_name: rec.image_name || undefined,
			width: rec.width,
			height: rec.height
		};
	}

	/** List item for a manifest id with no row in this catalog (unlinked / excluded / blob-store entry). */
	function toListItemFromManifest(fileId: string, manifest: Manifest): ImageListItem {
		return {
			id: fileId,
			file_name: manifest.files[fileId]?.file_name ?? '',
			image_name: undefined,
			width: undefined,
			height: undefined
		};
	}

	/**
	 * Read the basenames of real blobs currently in the global store (excludes manifest/settings/data
	 * files, lock files, and dotfiles).
	 */
	async function readDiskBlobNames(): Promise<string[]> {
		const paths = p();
		const dirents = await fs
			.readdir(paths.imagesDir, { withFileTypes: true })
			.catch(() => [] as fssync.Dirent[]);
		return dirents
			.filter(
				(d) =>
					d.isFile() &&
					!d.name.startsWith('.') &&
					!d.name.endsWith('.lock') &&
					!NON_BLOB_NAMES.has(d.name)
			)
			.map((d) => d.name);
	}

	/**
	 * Resolves schema field type for a field key. image_name and unknown keys default to 'string'.
	 */
	function getFieldType(schema: SchemaDefinition, fieldKey: string): FieldType {
		const def = schema[fieldKey];
		if (def?.type) return def.type as FieldType;
		return 'string';
	}

	/**
	 * Evaluates a single record against one filter clause.
	 */
	function evaluateClause(rec: ImageRecord, clause: FilterClause, schema: SchemaDefinition): boolean {
		const { field, operator, value } = clause;
		const raw = (rec as Record<string, unknown>)[field];
		const fieldType = getFieldType(schema, field);

		const isEmpty = (v: unknown) => {
			if (v === '' || v === undefined || v === null) return true;
			if (Array.isArray(v) && v.length === 0) return true;
			if (v != null && typeof v === 'object' && 'url' in (v as object))
				return !((v as { url?: string }).url ?? '').trim();
			return false;
		};

		if (operator === OPERATORS.is_empty) return isEmpty(raw);
		if (operator === OPERATORS.is_not_empty) return !isEmpty(raw);

		// For value-required operators, missing value => no match
		if (!VALUE_LESS_OPERATORS.has(operator) && value === undefined) return false;

		if (fieldType === 'number') {
			const num = typeof raw === 'number' && !Number.isNaN(raw) ? raw : Number(raw);
			const filterNum = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(num)) return false;
			if (Number.isNaN(filterNum) && operator !== OPERATORS.equals) return false;
			switch (operator) {
				case OPERATORS.equals:
					return num === filterNum;
				case OPERATORS.less_than:
					return num < filterNum;
				case OPERATORS.less_than_or_equal:
					return num <= filterNum;
				case OPERATORS.greater_than:
					return num > filterNum;
				case OPERATORS.greater_than_or_equal:
					return num >= filterNum;
				default:
					return false;
			}
		}

		if (fieldType === 'list') {
			const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
			const strVal = String(value ?? '').toLowerCase();
			const itemToStr = (item: unknown): string => {
				if (item != null && typeof item === 'object' && 'url' in (item as object)) {
					const o = item as { display_name?: string; url?: string };
					return (o.display_name ?? '') || (o.url ?? '');
				}
				return String(item);
			};
			switch (operator) {
				case OPERATORS.contains:
					return arr.some((item) => itemToStr(item).toLowerCase() === strVal);
				case OPERATORS.does_not_contain:
					return !arr.some((item) => itemToStr(item).toLowerCase() === strVal);
				default:
					return false;
			}
		}

		if (fieldType === 'boolean') {
			const bool = raw === true || raw === 'true';
			const target = value === true || value === 'true';
			if (operator === OPERATORS.equals) return bool === target;
			return false;
		}

		// url: compare against display_name and url (normalize legacy string to object)
		if (fieldType === 'url') {
			const urlVal = normalizeUrlValue(raw);
			const str = (urlVal.display_name + ' ' + urlVal.url).trim().toLowerCase();
			const filterStr = value != null ? String(value).toLowerCase() : '';
			switch (operator) {
				case OPERATORS.equals:
					return str === filterStr;
				case OPERATORS.contains:
					return str.includes(filterStr);
				case OPERATORS.starts_with:
					return str.startsWith(filterStr);
				case OPERATORS.ends_with:
					return str.endsWith(filterStr);
				default:
					return false;
			}
		}

		// dropdown multiselect: value is string[]; "equals" means array includes the filter value
		if (fieldType === 'dropdown') {
			const def = schema[field];
			if (def && (def as { multiselect?: boolean }).multiselect && Array.isArray(raw)) {
				const filterStr = value != null ? String(value) : '';
				const arr = raw as string[];
				switch (operator) {
					case OPERATORS.equals:
						return arr.includes(filterStr);
					case OPERATORS.contains:
						return arr.some((s) => s.toLowerCase().includes(filterStr.toLowerCase()));
					case OPERATORS.starts_with:
						return arr.some((s) => s.toLowerCase().startsWith(filterStr.toLowerCase()));
					case OPERATORS.ends_with:
						return arr.some((s) => s.toLowerCase().endsWith(filterStr.toLowerCase()));
					default:
						return false;
				}
			}
		}

		// string, dropdown (single): treat as string
		const str = raw != null ? String(raw).toLowerCase() : '';
		const filterStr = value != null ? String(value).toLowerCase() : '';
		switch (operator) {
			case OPERATORS.equals:
				return str === filterStr;
			case OPERATORS.contains:
				return str.includes(filterStr);
			case OPERATORS.starts_with:
				return str.startsWith(filterStr);
			case OPERATORS.ends_with:
				return str.endsWith(filterStr);
			default:
				return false;
		}
	}

	/**
	 * Applies all filter clauses to the linked list (AND). Skips invalid clauses (unknown field/operator).
	 */
	function applyFilters(linked: ImageRecord[], filters: FilterClause[], schema: SchemaDefinition): ImageRecord[] {
		if (!filters.length) return linked;
		return linked.filter((rec) => filters.every((clause) => evaluateClause(rec, clause, schema)));
	}

	async function listImages(params?: {
		query?: string | null;
		field?: string | null;
		empty?: boolean;
		groupBy?: string | null;
		filters?: FilterClause[] | null;
	}): Promise<ImageListResponse> {
		const paths = p();
		const settings = typeId ? readMediaTypeSettingsFileSync(paths.baseDir) : null;
		// blob_store is the global file browser: a flat, browse-only listing of every blob (no
		// linked/unlinked/excluded split). `generic` is a real catalog and gets the same
		// linked/unlinked/excluded semantics as `images`, but allows any file extension.
		const isDiskOnlyList = settings?.kind === 'blob_store';
		const allowAnyExtension = settings?.kind === 'generic';

		// 1. Read disk + reconcile the manifest (lazy heal) — done before any catalog lock.
		const diskNames = await readDiskBlobNames();
		const { added, missing, manifest } = await reconcile(diskNames);
		const healed = { added: added.length, missing: missing.length };
		const diskNameSet = new Set(diskNames);

		if (isDiskOnlyList) {
			const q = params?.query ? params.query.toLowerCase() : null;
			const unlinked: ImageListItem[] = [];
			for (const [id, entry] of Object.entries(manifest.files)) {
				if (!diskNameSet.has(entry.file_name)) continue;
				if (q && !entry.file_name.toLowerCase().includes(q)) continue;
				unlinked.push(toListItemFromManifest(id, manifest));
			}
			return {
				linked: [],
				unlinked,
				excluded: [],
				missing_files: [],
				excluded_missing_files: [],
				healed
			};
		}

		const schemaFile = await loadAndMigrateSchema();
		const excludedIds = new Set<string>(settings?.excludedFiles ?? []);

		const imageData = await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const synced = await ensureImagesSyncedToFilesystem(schemaFile.schema, base, manifest);
			if (synced.changed) await writeImageData(synced.imageData);
			return synced.imageData;
		});

		// Which manifest ids are real blobs on disk (images filters by extension; generic allows any).
		const onDiskFileIds = new Set<string>();
		for (const [id, entry] of Object.entries(manifest.files)) {
			if (!diskNameSet.has(entry.file_name)) continue;
			if (!allowAnyExtension && !hasAllowedImageExtension(entry.file_name)) continue;
			onDiskFileIds.add(id);
		}

		const rowsByFileId = new Map(imageData.images.map((r) => [r.id, r]));

		// Linked = rows whose blob is on disk. Unlinked = on-disk ids with no row, not excluded.
		let linked = imageData.images.filter((r) => onDiskFileIds.has(r.id));
		const unlinkedIds = [...onDiskFileIds].filter((id) => !rowsByFileId.has(id) && !excludedIds.has(id));
		const excludedIdsOnDisk = [...onDiskFileIds].filter((id) => !rowsByFileId.has(id) && excludedIds.has(id));
		const excluded_missing_files = [...excludedIds].filter((id) => !onDiskFileIds.has(id));

		const filters = params?.filters ?? null;
		if (filters != null && filters.length > 0) {
			linked = applyFilters(linked, filters, schemaFile.schema);
		} else {
			// Legacy: single query/field/empty
			const query = params?.query ?? null;
			const field = params?.field ?? null;
			const empty = params?.empty ?? false;
			if (query || empty) {
				linked = linked.filter((r) => {
					if (!field) return false;
					const value = (r as Record<string, unknown>)[field];
					if (empty) return value === '' || value === undefined || value === null;
					if (query && value !== undefined)
						return String(value).toLowerCase().includes(String(query).toLowerCase());
					return false;
				});
			}
		}

		const missing_files = imageData.images
			.filter((r) => !onDiskFileIds.has(r.id))
			.map((r) => toListItem(r, manifest));

		const groupBy = params?.groupBy ?? null;
		const withGroupBy = (rec: ImageRecord): ImageListItem => {
			const item = toListItem(rec, manifest);
			if (!groupBy) return item;
			const val = (rec as Record<string, unknown>)[groupBy];
			const def = schemaFile.schema[groupBy];
			let groupVal: string | number | boolean | string[] | null =
				val === undefined || val === null ? null : (val as string | number | boolean | string[]);
			if (def?.type === 'url' && val != null) {
				const urlVal = normalizeUrlValue(val);
				groupVal = (urlVal.display_name ?? '').trim() || urlVal.url || '';
			} else if (def?.type === 'list' && Array.isArray(val)) {
				groupVal = val
					.map((item: unknown) =>
						item != null && typeof item === 'object' && 'url' in (item as object)
							? ((item as { display_name?: string; url?: string }).display_name ?? '').trim() ||
							(item as { url: string }).url ||
							''
							: String(item)
					)
					.join(', ');
			} else if (def?.type === 'dropdown' && (def as { multiselect?: boolean }).multiselect && Array.isArray(val)) {
				groupVal = (val as string[]).join(', ');
			}
			return { ...item, group_by_value: groupVal };
		};

		const unlinked = unlinkedIds.map((id) => {
			const item = toListItemFromManifest(id, manifest);
			return groupBy != null
				? { ...item, group_by_value: null as string | number | boolean | string[] | null }
				: item;
		});
		const excluded = excludedIdsOnDisk.map((id) => {
			const item = toListItemFromManifest(id, manifest);
			return groupBy != null
				? { ...item, group_by_value: null as string | number | boolean | string[] | null }
				: item;
		});

		return {
			linked: linked.map(withGroupBy),
			unlinked,
			missing_files,
			excluded,
			excluded_missing_files,
			healed
		};
	}

	/**
	 * Returns a record by id (the blob's manifest id). URL fields are normalized and the manifest-resolved
	 * `file_name` is attached for the API. Returns null for an unlinked id (no row in this catalog).
	 */
	async function getRecordById(id: ImageId): Promise<ImageRecord | null> {
		const data = await loadAndMigrateImageData();
		const rec = data.images.find((r) => r.id === id) ?? null;
		if (!rec) return null;
		const manifest = await readManifest();
		const schemaFile = await loadAndMigrateSchema();
		const out = { ...enrichRecord(rec, manifest) } as Record<string, unknown>;
		for (const [key, def] of Object.entries(schemaFile.schema)) {
			if (def?.type === 'url' && key in out && out[key] != null) {
				out[key] = normalizeUrlValue(out[key]);
			}
		}
		return out as ImageRecord;
	}

	/** Find the catalog row for a filename (resolved via manifest), or null. */
	async function getRecordByFilename(filename: string): Promise<ImageRecord | null> {
		const safe = assertRecordFilename(filename);
		const manifest = await readManifest();
		let fileId: string | null = null;
		for (const [id, entry] of Object.entries(manifest.files)) {
			if (entry.file_name === safe) {
				fileId = id;
				break;
			}
		}
		if (!fileId) return null;
		const data = await loadAndMigrateImageData();
		const rec = data.images.find((r) => r.id === fileId) ?? null;
		return rec ? enrichRecord(rec, manifest) : null;
	}

	/**
	 * Ensure a catalog row exists for a `id` (the link operation). The row is created under the
	 * **same** id, so linking never changes a blob's identity.
	 *
	 * @param fileId - Manifest id of an existing blob.
	 * @returns The (existing or newly created) row, enriched with `id` + resolved `file_name`.
	 */
	async function ensureRecordForFileId(fileId: string): Promise<ImageRecord> {
		const schemaFile = await loadAndMigrateSchema();
		const paths = p();
		const manifest = await readManifest();
		const fileName = manifest.files[fileId]?.file_name;
		if (!fileName) throw new Error('Unknown id');

		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const existing = base.images.find((r) => r.id === fileId);
			if (existing) return enrichRecord(existing, manifest);

			const defaults: Record<string, unknown> = {};
			for (const [key, def] of Object.entries(schemaFile.schema)) {
				if (key === 'id' || key === 'last_modified' || key === 'default') continue;
				// generic / blob_store kinds don't get image_name
				if (key === 'image_name' && typeId) {
					const settings = readMediaTypeSettingsFileSync(paths.baseDir);
					if (settings?.kind === 'generic' || settings?.kind === 'blob_store') continue;
				}

				defaults[key] =
					def.defaultValue ??
					(def.type === 'boolean'
						? false
						: def.type === 'number'
							? 0
							: def.type === 'dropdown'
								? (def as { multiselect?: boolean }).multiselect
									? []
									: (def.options?.[0] ?? '')
								: def.type === 'list'
									? []
									: def.type === 'url'
										? { display_name: '', url: '' }
										: '');
			}

			const filePath = path.join(paths.imagesDir, fileName);
			const stats = await fs.stat(filePath).catch(() => null);
			const dimensions = await readImageDimensions(filePath);

			const created = ImageRecordSchema.parse({
				id: fileId,
				image_name: '',
				last_modified: stats ? stats.mtime.toISOString() : undefined,
				...defaults,
				width: dimensions.width,
				height: dimensions.height
			});

			await writeImageData({ images: [...base.images, created] });
			return enrichRecord(created, manifest);
		});
	}

	/**
	 * Ensure a catalog row exists for a filename (mints/looks up the manifest id, then links it).
	 * Thin back-compat wrapper over {@link ensureRecordForFileId}.
	 */
	async function ensureRecordForFilename(filename: string): Promise<ImageRecord> {
		const safe = assertRecordFilename(filename);
		const fileId = await mintFileId(safe);
		return ensureRecordForFileId(fileId);
	}

	async function updatePropertiesById(id: ImageId, patch: Record<string, unknown>): Promise<ImageRecord> {
		const schemaFile = await loadAndMigrateSchema();
		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const idx = base.images.findIndex((r) => r.id === id);
			if (idx === -1) throw new Error('Image record not found');

			const record = base.images[idx] as Record<string, unknown>;

			const stKind = typeId ? readMediaTypeSettingsFileSync(paths.baseDir)?.kind : null;
			const isGenericLike = stKind === 'generic' || stKind === 'blob_store';

			// Only allow schema-defined keys (plus image_name for images) to be updated here.
			const protectedKeys = ['id', 'last_modified', 'default', 'width', 'height'];
			const allowedKeys = new Set(Object.keys(schemaFile.schema));
			for (const k of protectedKeys) allowedKeys.delete(k);
			if (!isGenericLike) allowedKeys.add('image_name');

			const next: Record<string, unknown> = { ...record };
			for (const [k, v] of Object.entries(patch)) {
				if (allowedKeys.has(k)) {
					next[k] = v;
				} else if (k in record && !protectedKeys.includes(k) && v === null) {
					// Allow removing custom/orphaned keys by setting to null.
					delete next[k];
				}
			}
			next.last_modified = new Date().toISOString();

			const parsed = ImageRecordSchema.parse(next);
			const images = [...base.images];
			images[idx] = parsed;

			await writeImageData({ images });
			const manifest = await readManifest();
			return enrichRecord(parsed, manifest);
		});
	}

	/**
	 * Remove the catalog row entirely (the file + manifest entry stay; the blob returns to the unlinked
	 * list under the **same** id on next list).
	 */
	async function unlinkById(id: ImageId): Promise<void> {
		const paths = p();
		await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const idx = base.images.findIndex((r) => r.id === id);
			if (idx === -1) throw new Error('Image record not found');

			const images = base.images.filter((r) => r.id !== id);
			await writeImageData({ images });
		});
	}

	/**
	 * Compute the default value for a schema field definition (mirrors addSchemaField defaults).
	 */
	function defaultForFieldDef(def: {
		type?: string;
		defaultValue?: unknown;
		options?: string[];
		multiselect?: boolean;
	}): unknown {
		if (def?.defaultValue !== undefined && def.defaultValue !== null) {
			return def.type === 'url' ? normalizeUrlValue(def.defaultValue) : def.defaultValue;
		}
		switch (def?.type) {
			case 'boolean':
				return false;
			case 'number':
				return 0;
			case 'dropdown':
				return def.multiselect ? [] : (def.options?.[0] ?? '');
			case 'list':
				return [];
			case 'url':
				return { display_name: '', url: '' };
			default:
				return '';
		}
	}

	/**
	 * Update the same properties on many records in one call.
	 */
	async function bulkUpdatePropertiesByIds(
		ids: ImageId[],
		patch: Record<string, unknown>
	): Promise<ImageRecord[]> {
		const out: ImageRecord[] = [];
		for (const id of ids) {
			out.push(await updatePropertiesById(id, patch));
		}
		return out;
	}

	/**
	 * Unlink many records (remove their catalog rows; files stay on disk).
	 */
	async function bulkUnlinkByIds(ids: ImageId[]): Promise<void> {
		for (const id of ids) {
			await unlinkById(id);
		}
	}

	/**
	 * Delete many files from disk (global blob store) in one call. Each delete also strips the file's
	 * references from every catalog (see {@link deleteFromDiskById}).
	 */
	async function bulkDeleteFromDiskByIds(ids: ImageId[]): Promise<void> {
		for (const id of ids) {
			await deleteFromDiskById(id);
		}
	}

	/**
	 * Scan all records against the current schema and report records missing schema-defined fields.
	 */
	async function repairRecords(
		dryRun = true
	): Promise<{ issues: { id: string; field: string; issue: string; fix?: unknown }[]; fixed: number }> {
		const schemaFile = await loadAndMigrateSchema();
		const schema = schemaFile.schema;
		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const issues: { id: string; field: string; issue: string; fix?: unknown }[] = [];
			let fixed = 0;
			const images = base.images.map((rec) => {
				const recAny = rec as Record<string, unknown>;
				const next: Record<string, unknown> = { ...recAny };
				let recChanged = false;
				for (const [key, def] of Object.entries(schema)) {
					if (key === 'id') continue;
					if (recAny[key] === undefined) {
						const fix = defaultForFieldDef(def as never);
						issues.push({ id: rec.id as string, field: key, issue: 'Missing value', fix });
						if (!dryRun) {
							next[key] = fix;
							recChanged = true;
						}
					}
				}
				return recChanged ? ImageRecordSchema.parse(next) : rec;
			});
			const fixedCount = images.filter((img, i) => img !== base.images[i]).length;
			fixed = fixedCount;
			if (!dryRun && fixed > 0) await writeImageData({ images });
			return { issues, fixed };
		});
	}

	/**
	 * Replace this media type's entire schema (used by schema import and clone-from-type).
	 */
	async function importSchema(schema: SchemaDefinition): Promise<{ schema: SchemaDefinition }> {
		const paths = p();
		if (typeId) {
			const st0 = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st0?.kind === 'blob_store') throw new Error('Schema is not editable for blob store media types');
		}
		const validated = SchemaFileSchema.parse(migrateSchemaFile({ schema }).file).schema;
		return await withFileLock(`${paths.schemaPath}.lock`, async () => {
			if (typeId) {
				const settings = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: settings.kind, schema: validated });
			} else {
				await writeJsonFileAtomic(paths.schemaPath, { schema: validated });
			}
			await withFileLock(`${paths.imageDataPath}.lock`, async () => {
				const dataRaw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
				const { file: imageData } = migrateImageDataFile(dataRaw);
				let didChange = false;
				const images = imageData.images.map((img) => {
					const next = { ...(img as Record<string, unknown>) };
					for (const [key, def] of Object.entries(validated)) {
						if (key === 'id') continue;
						if (next[key] === undefined) {
							next[key] = defaultForFieldDef(def as never);
							didChange = true;
						}
					}
					return ImageRecordSchema.parse(next);
				});
				if (didChange) await writeImageData({ images });
			});
			return { schema: validated };
		});
	}

	async function addSchemaField(
		fieldName: string,
		fieldType: string,
		defaultValue: unknown,
		options?: string[],
		itemTypes?: string[],
		multiselect?: boolean
	) {
		const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'dropdown', 'list', 'url']);
		const parsedType = FieldTypeSchema.parse(fieldType);
		const key = normalizeFieldKey(fieldName);

		const paths = p();
		if (typeId) {
			const st0 = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st0?.kind === 'blob_store') throw new Error('Schema is not editable for blob store media types');
		}
		const lockPath = `${paths.schemaPath}.lock`;
		return await withFileLock(lockPath, async () => {
			let schemaFile: SchemaFile;
			if (typeId) {
				const settings = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
				schemaFile = migrateSchemaFile({ schema: settings.schema }).file;
			} else {
				const raw = await readJsonFileOrInit(paths.schemaPath, null, { schema: {} });
				schemaFile = migrateSchemaFile(raw).file;
			}

			const def: SchemaDefinition[string] = {
				type: parsedType,
				removable: true,
				defaultValue: defaultValue as never
			};
			if (parsedType === 'dropdown' && options?.length) {
				def.options = options;
				if (multiselect) def.multiselect = true;
			}
			if (parsedType === 'list' && itemTypes?.length) def.itemTypes = itemTypes as never;
			schemaFile.schema[key] = def;

			if (typeId) {
				const st = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!st) throw new Error(`Not a valid media-type folder: ${typeId}`);
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: st.kind, schema: schemaFile.schema });
			} else {
				await writeJsonFileAtomic(paths.schemaPath, schemaFile);
			}

			// Apply to all records as well (so forms stay consistent).
			await withFileLock(`${paths.imageDataPath}.lock`, async () => {
				const dataRaw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
				const { file: imageData, changed: imgChanged } = migrateImageDataFile(dataRaw);
				let didChange = imgChanged;

				let defaultVal: unknown;
				if (defaultValue !== undefined && defaultValue !== null) {
					defaultVal = parsedType === 'url' ? normalizeUrlValue(defaultValue) : defaultValue;
				} else {
					defaultVal =
						parsedType === 'boolean'
							? false
							: parsedType === 'number'
								? 0
								: parsedType === 'dropdown'
									? multiselect
										? []
										: (options?.[0] ?? '')
									: parsedType === 'list'
										? []
										: parsedType === 'url'
											? { display_name: '', url: '' }
											: '';
				}
				const images = imageData.images.map((img) => {
					const next = { ...(img as Record<string, unknown>) };
					if (next[key] === undefined) {
						next[key] = defaultVal;
						didChange = true;
					}
					return ImageRecordSchema.parse(next);
				});

				if (didChange) await writeImageData({ images });
			});

			return { schema: schemaFile.schema };
		});
	}

	async function updateSchemaField(
		oldKey: string,
		updates: {
			newKey?: string;
			type?: string;
			defaultValue?: unknown;
			options?: string[];
			itemTypes?: string[];
			multiselect?: boolean;
		}
	) {
		const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'dropdown', 'list', 'url']);
		const key = normalizeFieldKey(oldKey);
		if (isProtectedSchemaKey(key)) throw new Error('Field not modifiable');

		const paths = p();
		if (typeId) {
			const st0 = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st0?.kind === 'blob_store') throw new Error('Schema is not editable for blob store media types');
		}
		return await withFileLock(`${paths.schemaPath}.lock`, async () => {
			let schemaFile: SchemaFile;
			if (typeId) {
				const settings = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
				schemaFile = migrateSchemaFile({ schema: settings.schema }).file;
			} else {
				const raw = await readJsonFileOrInit(paths.schemaPath, null, { schema: {} });
				schemaFile = migrateSchemaFile(raw).file;
			}

			const def = schemaFile.schema[key];
			if (!def) throw new Error('Field not found');

			const newKey = updates.newKey ? normalizeFieldKey(updates.newKey) : key;
			if (newKey !== key && isProtectedSchemaKey(newKey)) throw new Error('Field not modifiable');

			const type = updates.type ? FieldTypeSchema.parse(updates.type) : def.type;
			const wasMultiselect = (def as { multiselect?: boolean }).multiselect === true;
			const multiselect = type === 'dropdown' ? (updates.multiselect ?? (def as { multiselect?: boolean }).multiselect ?? false) : false;

			let defaultValue = updates.defaultValue ?? def.defaultValue;
			if (type === 'url' && typeof defaultValue === 'string') {
				defaultValue = normalizeUrlValue(defaultValue);
			}
			// Coerce default when turning multiselect off: array -> first element
			if (type === 'dropdown' && wasMultiselect && !multiselect && Array.isArray(defaultValue)) {
				defaultValue = defaultValue[0] ?? '';
			}
			const options = updates.options ?? def.options;
			const itemTypes = updates.itemTypes ?? (def as { itemTypes?: string[] }).itemTypes;

			if (type === 'dropdown' && options?.length && defaultValue !== undefined) {
				if (multiselect) {
					if (Array.isArray(defaultValue)) {
						for (const v of defaultValue) {
							if (!options.includes(String(v))) throw new Error('Default value items must be in options');
						}
					}
				} else {
					const strVal = String(defaultValue);
					if (!options.includes(strVal)) throw new Error('Default value must be one of the options');
				}
			}
			if (type === 'list' && defaultValue !== undefined && !Array.isArray(defaultValue)) {
				throw new Error('List default must be an array');
			}

			delete schemaFile.schema[key];
			schemaFile.schema[newKey] = {
				type,
				removable: def.removable,
				defaultValue: defaultValue as never,
				...(options?.length ? { options } : {}),
				...(type === 'list' && itemTypes?.length ? { itemTypes: itemTypes as never } : {}),
				...(type === 'dropdown' && multiselect ? { multiselect: true } : {})
			};

			if (typeId) {
				const st = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!st) throw new Error(`Not a valid media-type folder: ${typeId}`);
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: st.kind, schema: schemaFile.schema });
			} else {
				await writeJsonFileAtomic(paths.schemaPath, schemaFile);
			}

			if (newKey !== key) {
				await withFileLock(`${paths.imageDataPath}.lock`, async () => {
					const dataRaw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
					const { file: imageData } = migrateImageDataFile(dataRaw);
					const images = imageData.images.map((img) => {
						const next = { ...(img as Record<string, unknown>) };
						if (key in next) {
							next[newKey] = next[key];
							delete next[key];
						}
						return ImageRecordSchema.parse(next);
					});
					await writeImageData({ images });
				});
			} else if (wasMultiselect && !multiselect) {
				// Coerce record values: array -> first element
				await withFileLock(`${paths.imageDataPath}.lock`, async () => {
					const dataRaw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
					const { file: imageData } = migrateImageDataFile(dataRaw);
					const images = imageData.images.map((img) => {
						const next = { ...(img as Record<string, unknown>) };
						const val = next[newKey];
						if (Array.isArray(val)) next[newKey] = val[0] ?? '';
						return ImageRecordSchema.parse(next);
					});
					await writeImageData({ images });
				});
			}

			return { schema: schemaFile.schema };
		});
	}

	async function deleteSchemaField(fieldName: string, removeFromImages?: boolean) {
		const key = normalizeFieldKey(fieldName);
		if (isProtectedSchemaKey(key)) throw new Error('Field not removable');

		const paths = p();
		if (typeId) {
			const st0 = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st0?.kind === 'blob_store') throw new Error('Schema is not editable for blob store media types');
		}
		return await withFileLock(`${paths.schemaPath}.lock`, async () => {
			let schemaFile: SchemaFile;
			if (typeId) {
				const settings = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
				schemaFile = migrateSchemaFile({ schema: settings.schema }).file;
			} else {
				const raw = await readJsonFileOrInit(paths.schemaPath, null, { schema: {} });
				schemaFile = migrateSchemaFile(raw).file;
			}

			const def = schemaFile.schema[key];
			if (!def) throw new Error('Field not found');
			if (def.removable === false) throw new Error('Field not removable');

			delete schemaFile.schema[key];
			if (typeId) {
				const st = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!st) throw new Error(`Not a valid media-type folder: ${typeId}`);
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: st.kind, schema: schemaFile.schema });
			} else {
				await writeJsonFileAtomic(paths.schemaPath, schemaFile);
			}

			if (removeFromImages) {
				await withFileLock(`${paths.imageDataPath}.lock`, async () => {
					const dataRaw = await readJsonFileOrInit(paths.imageDataPath, null, { images: [] });
					const { file: imageData } = migrateImageDataFile(dataRaw);

					const images = imageData.images.map((img) => {
						const next = { ...(img as Record<string, unknown>) };
						delete next[key];
						return ImageRecordSchema.parse(next);
					});

					await writeImageData({ images });
				});
			}

			return { schema: schemaFile.schema };
		});
	}

	async function getSchema(): Promise<SchemaDefinition> {
		const schemaFile = await loadAndMigrateSchema();
		return schemaFile.schema;
	}

	/**
	 * Returns unique values for a field across all records.
	 */
	async function getUniqueFieldValues(fieldName: string): Promise<string[]> {
		const data = await loadAndMigrateImageData();
		const seen = new Set<string>();
		const itemToStr = (item: unknown): string => {
			if (item != null && typeof item === 'object' && 'url' in (item as object)) {
				const o = item as { display_name?: string; url?: string };
				return (o.display_name ?? '').trim() || (o.url ?? '').trim();
			}
			return String(item).trim();
		};
		for (const rec of data.images) {
			const v = (rec as Record<string, unknown>)[fieldName];
			if (v === undefined || v === null) continue;
			if (Array.isArray(v)) {
				for (const item of v) {
					const s = itemToStr(item);
					if (s) seen.add(s);
				}
			} else if (typeof v === 'string' && v.trim()) {
				seen.add(v.trim());
			} else if (v != null && typeof v === 'object' && 'url' in v) {
				const s = itemToStr(v);
				if (s) seen.add(s);
			} else if (typeof v === 'number' && !Number.isNaN(v)) {
				seen.add(String(v));
			}
		}
		return [...seen].sort();
	}

	/**
	 * Resolve a manifest id to its filename, verifying the blob is present on disk.
	 * Returns null if the id is unknown or its blob is missing.
	 */
	async function getFilenameForId(id: ImageId): Promise<string | null> {
		const manifest = await readManifest();
		const name = manifest.files[id]?.file_name;
		if (!name) return null;
		const safe = assertRecordFilename(name);
		const paths = p();
		try {
			await fs.access(path.join(paths.imagesDir, safe));
			return safe;
		} catch {
			return null;
		}
	}

	/**
	 * Delete the blob from disk, drop its manifest entry, and strip its references from every catalog.
	 *
	 * @param id - id of the blob to delete.
	 */
	async function deleteFromDiskById(id: ImageId): Promise<void> {
		const manifest = await readManifest();
		const entry = manifest.files[id];
		if (!entry) throw new Error('Image record not found');

		const paths = p();
		const filePath = path.join(paths.imagesDir, entry.file_name);
		await fs.unlink(filePath).catch((err) => {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'ENOENT') throw err;
		});

		await removeFileId(id);
		await removeCatalogReferencesToFileIdGlobally(id);
	}

	/**
	 * Rename a blob: rename the file on disk, then update the single manifest entry. No catalog rows are
	 * touched and there is no cross-catalog fan-out — every reference (by `id`) is unaffected.
	 *
	 * @param id - id of the blob.
	 * @param newFilename - New basename (validated per kind).
	 * @returns The record (enriched with the new `file_name`) for linked blobs, or a minimal stub for
	 *   unlinked ones.
	 */
	async function renameFileById(id: ImageId, newFilename: string): Promise<ImageRecord> {
		const safe = assertRecordFilename(newFilename);
		const paths = p();

		const manifest = await readManifest();
		const entry = manifest.files[id];
		if (!entry) throw new Error('Image record not found');

		const oldFilename = entry.file_name;
		if (safe === oldFilename) {
			return (await getRecordById(id)) ?? ({ id, file_name: safe, image_name: '' } as unknown as ImageRecord);
		}

		const oldPath = path.join(paths.imagesDir, oldFilename);
		const newPath = path.join(paths.imagesDir, safe);

		if (fssync.existsSync(newPath)) {
			const err = new Error('Target filename already exists');
			(err as { status?: number }).status = 409;
			throw err;
		}

		await fs.rename(oldPath, newPath);
		try {
			await manifestRenameFileId(id, safe);
		} catch (err) {
			// Best-effort rollback so disk and manifest do not drift on partial failure.
			await fs.rename(newPath, oldPath).catch(() => {});
			throw err;
		}

		return (await getRecordById(id)) ?? ({ id, file_name: safe, image_name: '' } as unknown as ImageRecord);
	}

	return {
		get paths() {
			return typeId ? getPathsForType(typeId) : getAssetPaths();
		},
		getSchema,
		getUniqueFieldValues,
		addSchemaField,
		updateSchemaField,
		deleteSchemaField,
		importSchema,
		listImages,
		getRecordById,
		getRecordByFilename,
		ensureRecordForFilename,
		ensureRecordForFileId,
		getFilenameForId,
		updatePropertiesById,
		bulkUpdatePropertiesByIds,
		unlinkById,
		bulkUnlinkByIds,
		repairRecords,
		deleteFromDiskById,
		bulkDeleteFromDiskByIds,
		renameFileById
	};
}

/**
 * Create a repo for a media type by typeId (folder name under root).
 *
 * @returns ImageRepo for file-backed kinds (`images`, `generic`, `blob_store`), JsonRepo for `json`
 */
export function createMediaTypeRepo(typeId: string): ImageRepo | JsonRepo {
	const paths = getMediaTypePaths(typeId);
	if (usesImageRepoKind(paths.kind)) return createImageRepo(typeId);
	return createJsonRepoForType(typeId);
}

/**
 * Generate a unique filename by appending (1), (2), etc. if the name already exists.
 */
export function generateUniqueFilename(baseFilename: string, dir: string): string {
	if (!fssync.existsSync(path.join(dir, baseFilename))) return baseFilename;
	const ext = path.extname(baseFilename);
	const name = path.basename(baseFilename, ext);
	let n = 1;
	while (n <= 999) {
		const candidate = `${name} (${n})${ext}`;
		if (!fssync.existsSync(path.join(dir, candidate))) return candidate;
		n++;
	}
	throw new Error('Too many filename conflicts');
}

/** Whether a record references a blob by its `id` (as the row key or any embedded file-field value). */
function recordReferencesFileId(rec: unknown, fileId: string): boolean {
	if (rec == null || typeof rec !== 'object') return false;
	const r = rec as Record<string, unknown>;
	if (r.id === fileId) return true;
	const valueRefs = (v: unknown): boolean => {
		if (typeof v === 'string') return v === fileId;
		if (Array.isArray(v)) return v.some(valueRefs);
		return false;
	};
	for (const [k, v] of Object.entries(r)) {
		if (k === 'id') continue;
		if (valueRefs(v)) return true;
	}
	return false;
}

/**
 * Remove every file-backed catalog row keyed by `fileId` across the workspace (does not delete the
 * blob on disk — the caller does that). Operates on the raw data file so it never throws on a
 * not-yet-migrated catalog.
 *
 * @param fileId - The blob's manifest id.
 * @returns typeIds whose catalog JSON was modified.
 *
 * Concerns / future improvements:
 * - This removes whole rows whose primary key is the deleted blob; it does **not** clear embedded
 *   `file`-field references in other rows/json records. A future pass could null those out.
 */
export async function removeCatalogReferencesToFileIdGlobally(fileId: string): Promise<string[]> {
	const affected: string[] = [];
	for (const tId of listMediaTypeIds()) {
		const mp = getMediaTypePaths(tId);
		if (mp.kind !== 'images' && mp.kind !== 'generic' && mp.kind !== 'blob_store') continue;
		const didRemove = await withFileLock(`${mp.dataPath}.lock`, async () => {
			if (!fssync.existsSync(mp.dataPath)) return false;
			let raw: { images?: unknown[] };
			try {
				raw = (await readJsonFile(mp.dataPath)) as { images?: unknown[] };
			} catch {
				return false;
			}
			const rows = Array.isArray(raw.images) ? raw.images : [];
			const kept = rows.filter((r) => (r as Record<string, unknown>)?.id !== fileId);
			if (kept.length === rows.length) return false;
			await writeJsonFileAtomic(mp.dataPath, { ...raw, images: kept });
			return true;
		});
		if (didRemove) affected.push(tId);
	}
	return affected;
}

/**
 * Which media types currently reference this blob (by `id` row key or embedded file-field value).
 * Sync read used for delete confirmations / global-file-usage.
 *
 * @param fileId - The blob's manifest id.
 */
export function listCatalogTypesReferencingFileIdSync(
	fileId: string
): { typeId: string; displayName: string }[] {
	const out: { typeId: string; displayName: string }[] = [];
	for (const tId of listMediaTypeIds()) {
		const mp = getMediaTypePaths(tId);
		if (!fssync.existsSync(mp.dataPath)) continue;
		const settings = readMediaTypeSettingsFileSync(mp.baseDir);
		try {
			const raw = JSON.parse(fssync.readFileSync(mp.dataPath, 'utf-8')) as {
				images?: unknown[];
				records?: unknown[];
			};
			const rows = Array.isArray(raw.images)
				? raw.images
				: Array.isArray(raw.records)
					? raw.records
					: [];
			if (rows.some((r) => recordReferencesFileId(r, fileId))) {
				out.push({ typeId: tId, displayName: settings?.displayName ?? tId });
			}
		} catch {
			/* skip corrupt */
		}
	}
	return out;
}
