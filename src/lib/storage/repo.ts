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
import { newImageId, type ImageId } from '$lib/core/ids.js';
import { hasAllowedImageExtension } from '$lib/core/images.js';
import {
	type FilterClause,
	OPERATORS,
	VALUE_LESS_OPERATORS
} from '$lib/core/filters.js';
import type { FieldType } from '$lib/core/types.js';

/**
 * Storage repository for images, properties, and schema backed by filesystem JSON files.
 *
 * Use case:
 * - Centralizes reading/writing `schema.json`, `image-data.json`, and the images directory.
 * - Performs migrations (adds `imageId`, normalizes legacy keys) and returns typed results.
 *
 * Concerns / future improvements:
 * - This is still a single-node filesystem implementation. For a future CLI+UI package, this should accept
 *   a configurable root and potentially alternative storage backends (sqlite, cloud, etc.).
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

	/** Safe filename for disk paths: image extensions unless `generic` kind (any basename). */
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
	 *
	 * Concerns / future improvements:
	 * - For a real CLI, formalize a config file and versioned migrations for the metadata directory.
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

	async function ensureImagesSyncedToFilesystem(schema: SchemaDefinition, imageData: ImageDataFile): Promise<{
		imageData: ImageDataFile;
		changed: boolean;
	}> {
		const paths = p();
		if (!fssync.existsSync(paths.imagesDir)) {
			await fs.mkdir(paths.imagesDir, { recursive: true });
		}

		// Backfill width/height for records missing dimensions.
		let changed = false;
		const images = await Promise.all(
			imageData.images.map(async (img) => {
				if (img.width != null && img.height != null) return img;
				if ((img as any).is_template) return img;
				const filePath = path.join(paths.imagesDir, img.file_name);
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

	function toListItem(rec: ImageRecord): ImageListItem {
		return {
			id: rec.id,
			file_name: rec.file_name,
			image_name: rec.image_name || undefined,
			width: rec.width,
			height: rec.height
		};
	}

	/** Build list item for an unlinked file (on disk but not in JSON). Id is "unlinked:" + encoded filename. */
	function toUnlinkedListItem(filename: string): ImageListItem {
		return {
			id: (`unlinked:${encodeURIComponent(filename)}`) as ImageId,
			file_name: filename,
			image_name: undefined,
			width: undefined,
			height: undefined
		};
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
	 * Uses schema to determine field type and applies the appropriate operator.
	 *
	 * @param rec - Image record
	 * @param clause - Filter clause (field, operator, optional value)
	 * @param schema - Schema definition for field types
	 * @returns true if the record matches the clause
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
		// contains with empty filterStr matches all (str.includes('') is true for any string)
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

		if (isDiskOnlyList) {
			const diskFiles = await fs.readdir(paths.imagesDir).catch(() => [] as string[]);
			const unlinked = [];
			const q = params?.query ? params.query.toLowerCase() : null;
			const skip = new Set<string>(['settings.json']);
			if (settings?.kind === 'blob_store') {
				skip.add(path.basename(paths.imageDataPath));
				skip.add('data.json');
			}
			for (const f of diskFiles) {
				if (skip.has(f) || f.startsWith('.')) continue;
				if (q && !f.toLowerCase().includes(q)) continue;
				try {
					const st = await fs.stat(path.join(paths.imagesDir, f));
					if (st.isFile()) {
						unlinked.push(toUnlinkedListItem(f));
					}
				} catch {
					// ignore stat errors
				}
			}
			return {
				linked: [],
				unlinked,
				excluded: [],
				missing_files: [],
				excluded_missing_files: []
			};
		}

		const schemaFile = await loadAndMigrateSchema();

		let excludedPaths: string[] = [];
		if (settings) {
			excludedPaths = settings.excludedFiles ?? [];
		}
		const excludedFilenames = new Set(excludedPaths);

		const imageData = await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const synced = await ensureImagesSyncedToFilesystem(schemaFile.schema, base);
			if (synced.changed) await writeImageData(synced.imageData);
			return synced.imageData;
		});

		// For `generic` catalogs, any non-hidden file counts; `images` (and legacy) only consider
		// allowed image extensions. Directories are excluded via dirent type.
		const dirents = await fs
			.readdir(paths.imagesDir, { withFileTypes: true })
			.catch(() => [] as fssync.Dirent[]);
		const diskFiles = new Set(
			dirents
				.filter((d) => d.isFile() && !d.name.startsWith('.'))
				.map((d) => d.name)
				.filter((f) => (allowAnyExtension ? true : hasAllowedImageExtension(f)))
		);

		// Linked = records in JSON that exist on disk. Unlinked = files on disk that are not in JSON.
		const jsonFilenames = new Set(
			imageData.images
				.filter((r) => !(r as any).is_template)
				.map((r) => r.file_name)
		);
		let linked = imageData.images.filter(
			(r) => !(r as any).is_template && diskFiles.has(r.file_name)
		);
		const unlinkedFilenames = [...diskFiles].filter((f) => !jsonFilenames.has(f) && !excludedFilenames.has(f));
		const unlinked = unlinkedFilenames.map(toUnlinkedListItem);

		const excludedFilenamesOnDisk = [...diskFiles].filter((f) => !jsonFilenames.has(f) && excludedFilenames.has(f));
		const excluded = excludedFilenamesOnDisk.map(toUnlinkedListItem);

		const excluded_missing_files = [...excludedFilenames].filter((f) => !diskFiles.has(f));

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
					const value = (r as any)[field];
					if (empty) return value === '' || value === undefined || value === null;
					if (query && value !== undefined)
						return String(value).toLowerCase().includes(String(query).toLowerCase());
					return false;
				});
			}
		}

		const missing_files = imageData.images
			.filter((r) => !(r as any).is_template)
			.filter((r) => !diskFiles.has(r.file_name))
			.map(toListItem);

		const groupBy = params?.groupBy ?? null;
		const withGroupBy = (rec: ImageRecord): ImageListItem => {
			const item = toListItem(rec);
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

		const unlinkedItems =
			groupBy != null
				? unlinked.map((item) => ({ ...item, group_by_value: null as string | number | boolean | string[] | null }))
				: unlinked;

		const excludedItems =
			groupBy != null
				? excluded.map((item) => ({ ...item, group_by_value: null as string | number | boolean | string[] | null }))
				: excluded;

		return {
			linked: linked.map(withGroupBy),
			unlinked: unlinkedItems,
			missing_files,
			excluded: excludedItems,
			excluded_missing_files
		};
	}

	/**
	 * Returns a record by id. URL fields are normalized to { display_name, url } so legacy string values appear as objects.
	 * Unlinked list items use id "unlinked:filename"; they have no record in JSON, so return null.
	 */
	async function getRecordById(id: ImageId): Promise<ImageRecord | null> {
		if (typeof id === 'string' && id.startsWith('unlinked:')) return null;
		const data = await loadAndMigrateImageData();
		const rec = data.images.find((r) => r.id === id) ?? null;
		if (!rec) return null;
		const schemaFile = await loadAndMigrateSchema();
		const out = { ...rec } as Record<string, unknown>;
		for (const [key, def] of Object.entries(schemaFile.schema)) {
			if (def?.type === 'url' && key in out && out[key] != null) {
				out[key] = normalizeUrlValue(out[key]);
			}
		}
		return out as ImageRecord;
	}

	async function getRecordByFilename(filename: string): Promise<ImageRecord | null> {
		const safe = assertRecordFilename(filename);
		const data = await loadAndMigrateImageData();
		return data.images.find((r) => r.file_name === safe) ?? null;
	}

	async function ensureRecordForFilename(filename: string): Promise<ImageRecord> {
		const safe = assertRecordFilename(filename);
		const schemaFile = await loadAndMigrateSchema();

		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const existing = base.images.find((r) => r.file_name === safe);
			if (existing) return existing;

			const defaults: Record<string, any> = {};
			for (const [key, def] of Object.entries(schemaFile.schema)) {
				if (key === 'file_name' || key === 'last_modified' || key === 'default') continue;
				// generic kind doesn't get image_name
				if (key === 'image_name') {
					if (typeId) {
						const settings = readMediaTypeSettingsFileSync(paths.baseDir);
						if (settings?.kind === 'generic' || settings?.kind === 'blob_store') continue;
					}
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

			const filePath = path.join(paths.imagesDir, safe);
			const stats = await fs.stat(filePath).catch(() => null);
			const dimensions = await readImageDimensions(filePath);

			const created = ImageRecordSchema.parse({
				id: newImageId(),
				file_name: safe,
				image_name: '',
				last_modified: stats ? stats.mtime.toISOString() : undefined,
				...defaults,
				width: dimensions.width,
				height: dimensions.height
			});

			await writeImageData({ images: [...base.images, created] });
			return created;
		});
	}

	async function updatePropertiesById(id: ImageId, patch: Record<string, unknown>): Promise<ImageRecord> {
		const schemaFile = await loadAndMigrateSchema();
		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const idx = base.images.findIndex((r) => r.id === id);
			if (idx === -1) throw new Error('Image record not found');

			const record = base.images[idx] as any;

			const stKind = typeId ? readMediaTypeSettingsFileSync(paths.baseDir)?.kind : null;
			const isGenericLike = stKind === 'generic' || stKind === 'blob_store';

			// Only allow schema-defined keys (plus image_name for images) to be updated here.
			const allowedKeys = new Set(Object.keys(schemaFile.schema));
			allowedKeys.delete('file_name');
			allowedKeys.delete('last_modified');
			allowedKeys.delete('default');
			allowedKeys.delete('id');
			allowedKeys.delete('is_template');
			allowedKeys.delete('width');
			allowedKeys.delete('height');
			if (!isGenericLike) allowedKeys.add('image_name');

			const next: any = { ...record };
			for (const [k, v] of Object.entries(patch)) {
				if (allowedKeys.has(k)) {
					next[k] = v;
				} else if (
					k in record &&
					!['id', 'file_name', 'last_modified', 'is_template', 'width', 'height'].includes(k) &&
					v === null
				) {
					// Allow removing custom/orphaned keys by setting to null.
					delete next[k];
				}
			}
			next.last_modified = new Date().toISOString();

			const parsed = ImageRecordSchema.parse(next);
			const images = [...base.images];
			images[idx] = parsed;

			await writeImageData({ images });
			return parsed;
		});
	}

	/**
	 * Remove the image record from image-data.json entirely.
	 * The file stays on disk; it will reappear in the unlinked list on next sync (with a new id).
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
	 *
	 * @param def - Field definition from the schema
	 * @returns A sensible empty/default value for the field's type
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
	 *
	 * @param ids - Record ids to update
	 * @param patch - Property patch applied to each (schema-validated per record)
	 * @returns The updated records
	 *
	 * Concerns / future improvements:
	 * - Takes the data-file lock once per record; acceptable for typical selection sizes.
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
	 *
	 * @param ids - Record ids to unlink
	 */
	async function bulkUnlinkByIds(ids: ImageId[]): Promise<void> {
		for (const id of ids) {
			await unlinkById(id);
		}
	}

	/**
	 * Delete many files from disk (global blob store) in one call. Each delete also strips the file's
	 * references from every catalog (see {@link deleteFromDiskById}).
	 *
	 * @param ids - Record ids whose backing files should be deleted
	 */
	async function bulkDeleteFromDiskByIds(ids: ImageId[]): Promise<void> {
		for (const id of ids) {
			await deleteFromDiskById(id);
		}
	}

	/**
	 * Scan all (non-template) records against the current schema and report records that are missing
	 * schema-defined fields. Missing fields are filled with the field's default value.
	 *
	 * @param dryRun - When true, only report issues; when false, persist fixes
	 * @returns Issues found and number of records modified (0 on dry run)
	 *
	 * Concerns / future improvements:
	 * - Currently only detects/fills missing fields; does not coerce type mismatches (kept conservative
	 *   to avoid destructive changes).
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
				if ((rec as { is_template?: boolean }).is_template) return rec;
				const recAny = rec as Record<string, unknown>;
				const next: Record<string, unknown> = { ...recAny };
				let recChanged = false;
				for (const [key, def] of Object.entries(schema)) {
					if (key === 'file_name') continue;
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
	 * Validates the incoming definition, persists it, then backfills defaults for any newly added
	 * fields onto existing records.
	 *
	 * @param schema - Full schema definition to apply
	 * @returns The validated schema that was written
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
						if (key === 'file_name') continue;
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
		multiselect?: boolean,
		long?: boolean
	) {
		const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'dropdown', 'list', 'url']);
		const parsedType = FieldTypeSchema.parse(fieldType);
		const key = normalizeFieldKey(fieldName);

		const paths = p();
		if (typeId) {
			const st0 = readMediaTypeSettingsFileSync(paths.baseDir);
			if (st0?.kind === 'blob_store') throw new Error('Schema is not editable for blob store media types');
		}
		const lockPath = typeId ? `${paths.schemaPath}.lock` : `${paths.schemaPath}.lock`;
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

			const def: any = {
				type: parsedType,
				removable: true,
				defaultValue: defaultValue as any
			};
			if (parsedType === 'dropdown' && options?.length) {
				def.options = options;
				if (multiselect) def.multiselect = true;
			}
			if (parsedType === 'list' && itemTypes?.length) def.itemTypes = itemTypes;
			if (parsedType === 'string' && long) def.long = true;
			schemaFile.schema[key] = def;

			if (typeId) {
				const st = readMediaTypeSettingsFileSync(paths.baseDir);
				if (!st) throw new Error(`Not a valid media-type folder: ${typeId}`);
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: st.kind, schema: schemaFile.schema });
			} else {
				await writeJsonFileAtomic(paths.schemaPath, schemaFile);
			}

			// Apply to all image records as well (so forms stay consistent).
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
					const next: any = { ...img };
					if ((next as any)[key] === undefined) {
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
			long?: boolean;
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
			const wasMultiselect = (def as any).multiselect === true;
			const multiselect = type === 'dropdown' ? (updates.multiselect ?? (def as any).multiselect ?? false) : false;

			let defaultValue = updates.defaultValue ?? def.defaultValue;
			if (type === 'url' && typeof defaultValue === 'string') {
				defaultValue = normalizeUrlValue(defaultValue);
			}
			// Coerce default when turning multiselect off: array -> first element
			if (type === 'dropdown' && wasMultiselect && !multiselect && Array.isArray(defaultValue)) {
				defaultValue = defaultValue[0] ?? '';
			}
			const options = updates.options ?? def.options;
			const itemTypes = updates.itemTypes ?? (def as any).itemTypes;

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

			const long = type === 'string' ? (updates.long ?? (def as any).long ?? false) : false;

			delete schemaFile.schema[key];
			schemaFile.schema[newKey] = {
				type,
				removable: def.removable,
				defaultValue: defaultValue as any,
				...(options?.length ? { options } : {}),
				...(type === 'list' && itemTypes?.length ? { itemTypes } : {}),
				...(type === 'dropdown' && multiselect ? { multiselect: true } : {}),
				...(type === 'string' && long ? { long: true } : {})
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
						const next: any = { ...img };
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
						const next: any = { ...img };
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
						const next: any = { ...img };
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
	 * Returns unique values for a field across all image records.
	 * For list fields: flattens arrays and dedupes. For string fields: collects unique strings.
	 *
	 * @param fieldName - Schema field key (e.g. tags, category)
	 * @returns Sorted array of unique string values
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
			const v = (rec as any)[fieldName];
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

	async function getFilenameForId(id: ImageId): Promise<string | null> {
		if (typeof id === 'string' && id.startsWith('unlinked:')) {
			const decoded = decodeURIComponent(id.slice(9));
			const safe = assertRecordFilename(decoded);
			const paths = p();
			const filePath = path.join(paths.imagesDir, safe);
			try {
				await fs.access(filePath);
				return safe;
			} catch {
				return null;
			}
		}
		const rec = await getRecordById(id);
		return rec?.file_name ? assertRecordFilename(rec.file_name) : null;
	}

	/**
	 * Delete the image file from disk and, if it was in JSON, remove its record.
	 *
	 * @param id - ImageId (UUID for linked, or "unlinked:filename" for unlinked)
	 * @throws Error if file not found or deletion fails
	 */
	async function deleteFromDiskById(id: ImageId): Promise<void> {
		const filename = await getFilenameForId(id);
		if (!filename) throw new Error('Image record not found');

		const paths = p();
		const filePath = path.join(paths.imagesDir, filename);
		await fs.unlink(filePath).catch((err) => {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'ENOENT') throw err;
		});

		await removeCatalogReferencesToFileGlobally(filename);
	}

	/**
	 * Propagate a filename change to every media type in the workspace that references the old basename.
	 *
	 * Because the blob lives in the single shared global `files/` store, the same basename can be
	 * referenced by many catalogs at once. After renaming the physical file, this rewrites, across
	 * all types:
	 * - `settings.excludedFiles` entries (`oldFilename` -> `safe`)
	 * - `images`/`generic`/`blob_store` record `file_name` fields
	 * - embedded filename values in any field (plain string, `{ url }`, or arrays thereof) for both
	 *   file-backed records and `json` records
	 *
	 * @param oldFilename - Current basename being renamed away from.
	 * @param safe - Validated new basename.
	 * @param currentTypeId - The renaming type's id (or `null` for the legacy single-folder layout).
	 *   Its own record `file_name` is skipped here because the caller already updated it; passing it
	 *   avoids a redundant double-write. Embedded field values in the current type are still updated.
	 *
	 * Concerns / future improvements:
	 * - This is O(number of media types) per rename and matches on string equality; a stable file id
	 *   (see `docs/STABLE_FILE_IDS.md`) would make this a single manifest update instead.
	 */
	async function propagateFilenameRename(
		oldFilename: string,
		safe: string,
		currentTypeId: string | null | undefined
	): Promise<void> {
		const allTypes = listMediaTypeIds();
		for (const tId of allTypes) {
			const mPaths = getMediaTypePaths(tId);
			const settings = readMediaTypeSettingsFileSync(mPaths.baseDir);
			if (!settings) continue;

			if (settings.excludedFiles?.includes(oldFilename)) {
				const newExcluded = settings.excludedFiles.map((f) => (f === oldFilename ? safe : f));
				await writeMediaTypeSettingsFile(mPaths.baseDir, {
					kind: settings.kind,
					schema: settings.schema,
					excludedFiles: newExcluded
				});
			}

			const dataPath = mPaths.dataPath;
			const lockPath = `${dataPath}.lock`;
			await withFileLock(lockPath, async () => {
				try {
					const raw = (await readJsonFile(dataPath)) as any;
					let changed = false;

					const updateVal = (v: any): any => {
						if (typeof v === 'string' && v === oldFilename) {
							changed = true;
							return safe;
						}
						if (v && typeof v === 'object' && 'url' in v && (v as any).url === oldFilename) {
							changed = true;
							return { ...(v as any), url: safe };
						}
						if (Array.isArray(v)) {
							const updatedArr = [];
							let arrChanged = false;
							for (const item of v) {
								if (typeof item === 'string' && item === oldFilename) {
									updatedArr.push(safe);
									arrChanged = true;
								} else if (item && typeof item === 'object' && 'url' in item && (item as any).url === oldFilename) {
									updatedArr.push({ ...(item as any), url: safe });
									arrChanged = true;
								} else {
									updatedArr.push(item);
								}
							}
							if (arrChanged) {
								changed = true;
								return updatedArr;
							}
						}
						return v;
					};

					if (
						(settings.kind === 'images' ||
							settings.kind === 'generic' ||
							settings.kind === 'blob_store') &&
						Array.isArray(raw.images)
					) {
						for (const rec of raw.images) {
							if (rec.file_name === oldFilename && tId !== currentTypeId) {
								rec.file_name = safe;
								changed = true;
							}
							for (const [k, v] of Object.entries(rec)) {
								if (k === 'file_name' || k === 'id') continue;
								const nextV = updateVal(v);
								if (nextV !== v) rec[k] = nextV;
							}
						}
					} else if (settings.kind === 'json' && Array.isArray(raw.records)) {
						for (const rec of raw.records) {
							for (const [k, v] of Object.entries(rec)) {
								if (k === 'id') continue;
								const nextV = updateVal(v);
								if (nextV !== v) rec[k] = nextV;
							}
						}
					}

					if (changed) {
						await writeJsonFileAtomic(dataPath, raw);
					}
				} catch (e) {
					const err = e as NodeJS.ErrnoException;
					if (err.code !== 'ENOENT') {
						console.error(`Error updating refs in ${tId}:`, e);
					}
				}
			});
		}
	}

	/**
	 * Rename an image file on disk and update its record in image-data.json.
	 *
	 * @param id - Image record id (UUID)
	 * @param newFilename - New filename (validated via assertSafeImageFilename, or assertSafeBasename for generic)
	 * @returns Updated ImageRecord
	 * @throws Error if record not found, target exists, or rename fails
	 */
	async function renameFileById(id: ImageId, newFilename: string): Promise<ImageRecord> {
		const safe = assertRecordFilename(newFilename);
		const paths = p();

		const settings = typeId ? readMediaTypeSettingsFileSync(paths.baseDir) : null;
		const isGeneric = settings?.kind === 'generic' || settings?.kind === 'blob_store';

		if (isGeneric && typeof id === 'string' && id.startsWith('unlinked:')) {
			const oldFilename = assertRecordFilename(decodeURIComponent(id.slice(9)));
			const oldPath = path.join(paths.imagesDir, oldFilename);
			const newPath = path.join(paths.imagesDir, safe);
			if (safe === oldFilename) {
				return {
					id,
					file_name: safe,
					image_name: '',
					last_modified: new Date().toISOString()
				} as ImageRecord;
			}
			if (fssync.existsSync(newPath)) throw new Error('Target filename already exists');
			await fs.rename(oldPath, newPath);
			// The blob is shared across the workspace; keep every catalog reference in sync. This
			// path (blob_store / unlinked items) previously skipped propagation, leaving dangling
			// references after a rename.
			try {
				await propagateFilenameRename(oldFilename, safe, typeId);
			} catch (err) {
				// Best-effort rollback so disk and catalogs do not drift on partial failure.
				await fs.rename(newPath, oldPath).catch(() => {});
				throw err;
			}
			const newId = (`unlinked:${encodeURIComponent(safe)}`) as ImageId;
			return {
				id: newId,
				file_name: safe,
				image_name: '',
				last_modified: new Date().toISOString()
			} as ImageRecord;
		}

		// Get current record
		const data = await loadAndMigrateImageData();
		const rec = data.images.find((r) => r.id === id);
		if (!rec) throw new Error('Image record not found');

		const oldFilename = rec.file_name;
		if (safe === oldFilename) return rec;

		const oldPath = path.join(paths.imagesDir, oldFilename);
		const newPath = path.join(paths.imagesDir, safe);

		// Check target doesn't already exist
		if (fssync.existsSync(newPath)) {
			const err = new Error('Target filename already exists');
			(err as any).status = 409;
			throw err;
		}

		// Rename physical file first
		await fs.rename(oldPath, newPath);

		// Update record in JSON
		try {
			const updatedRecord = await withFileLock(`${paths.imageDataPath}.lock`, async () => {
				const base = await loadAndMigrateImageDataUnlocked();
				const idx = base.images.findIndex((r) => r.id === id);
				if (idx === -1) throw new Error('Image record not found');

				const next = { ...base.images[idx] as any };
				next.file_name = safe;
				next.last_modified = new Date().toISOString();
				const parsed = ImageRecordSchema.parse(next);
				const images = [...base.images];
				images[idx] = parsed;
				await writeImageData({ images });
				return parsed;
			});

			// Propagate the new filename to every other catalog that references the old basename.
			await propagateFilenameRename(oldFilename, safe, typeId);

			return updatedRecord;
		} catch (err) {
			// Best-effort rollback: rename file back
			await fs.rename(newPath, oldPath).catch(() => { });
			throw err;
		}
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
 * Returns an image repo or JSON repo depending on the type's kind.
 *
 * @param typeId - Folder name under root (e.g. 'images', 'projects')
 * @returns ImageRepo for file-backed kinds (`images`, `generic`, `blob_store`), JsonRepo for `json`
 */
export function createMediaTypeRepo(typeId: string): ImageRepo | JsonRepo {
	const paths = getMediaTypePaths(typeId);
	if (usesImageRepoKind(paths.kind)) return createImageRepo(typeId);
	return createJsonRepoForType(typeId);
}

/**
 * Generate a unique filename by appending (1), (2), etc. if the name already exists.
 *
 * @param baseFilename - The desired filename (e.g. "photo.jpg")
 * @param dir - Directory to check for existing files
 * @returns A filename guaranteed to not exist in dir
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

/**
 * Remove every catalog row (images + generic types) that references `file_name` on the global blob store.
 * Does not delete the file on disk.
 *
 * @param file_name - Basename in `root/files/`
 * @returns typeIds whose catalog JSON was modified
 */
export async function removeCatalogReferencesToFileGlobally(file_name: string): Promise<string[]> {
	const safe = assertSafeBasename(file_name);
	const affected: string[] = [];
	for (const tId of listMediaTypeIds()) {
		const mp = getMediaTypePaths(tId);
		if (mp.kind !== 'images' && mp.kind !== 'generic' && mp.kind !== 'blob_store') continue;
		const didRemove = await withFileLock(`${mp.dataPath}.lock`, async () => {
			if (!fssync.existsSync(mp.dataPath)) return false;
			let raw: unknown;
			try {
				raw = await readJsonFile(mp.dataPath);
			} catch {
				return false;
			}
			const { file, changed: migChanged } = migrateImageDataFile(raw);
			const beforeLen = file.images.length;
			const images = file.images.filter((r) => r.file_name !== safe);
			if (images.length === beforeLen && !migChanged) return false;
			await writeJsonFileAtomic(mp.dataPath, { images });
			return images.length !== beforeLen;
		});
		if (didRemove) affected.push(tId);
	}
	return affected;
}

/**
 * Which image-catalog media types currently reference this filename (sync read for delete confirmations).
 *
 * @param file_name - Basename under global `files/`
 */
export function listCatalogTypesReferencingFileSync(file_name: string): { typeId: string; displayName: string }[] {
	const safe = assertSafeBasename(file_name);
	const out: { typeId: string; displayName: string }[] = [];
	for (const tId of listMediaTypeIds()) {
		const mp = getMediaTypePaths(tId);
		if (mp.kind !== 'images' && mp.kind !== 'generic' && mp.kind !== 'blob_store') continue;
		const settings = readMediaTypeSettingsFileSync(mp.baseDir);
		if (!fssync.existsSync(mp.dataPath)) continue;
		try {
			const raw = JSON.parse(fssync.readFileSync(mp.dataPath, 'utf-8')) as unknown;
			const { file } = migrateImageDataFile(raw);
			if (file.images.some((r) => r.file_name === safe)) {
				out.push({ typeId: tId, displayName: settings?.displayName ?? tId });
			}
		} catch {
			/* skip corrupt */
		}
	}
	return out;
}
