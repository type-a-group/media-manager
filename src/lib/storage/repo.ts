import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { getAssetPaths, getMediaTypePaths } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import { migrateImageDataFile, migrateSchemaFile } from './migrate.js';
import { assertSafeImageFilename } from './filenames.js';
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
	if (mp.kind !== 'images' || !mp.filesDir) throw new Error(`Media type ${typeId} is not images`);
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
		const schemaFile = await loadAndMigrateSchema();

		const paths = p();
		const imageData = await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const synced = await ensureImagesSyncedToFilesystem(schemaFile.schema, base);
			if (synced.changed) await writeImageData(synced.imageData);
			return synced.imageData;
		});

		const diskFiles = new Set(
			(await fs.readdir(paths.imagesDir).catch(() => [] as string[])).filter((f) => hasAllowedImageExtension(f))
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
		const unlinkedFilenames = [...diskFiles].filter((f) => !jsonFilenames.has(f));
		const unlinked = unlinkedFilenames.map(toUnlinkedListItem);

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

		return {
			linked: linked.map(withGroupBy),
			unlinked: unlinkedItems,
			missing_files
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
		const safe = assertSafeImageFilename(filename);
		const data = await loadAndMigrateImageData();
		return data.images.find((r) => r.file_name === safe) ?? null;
	}

	async function ensureRecordForFilename(filename: string): Promise<ImageRecord> {
		const safe = assertSafeImageFilename(filename);
		const schemaFile = await loadAndMigrateSchema();

		const paths = p();
		return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const existing = base.images.find((r) => r.file_name === safe);
			if (existing) return existing;

			const defaults: Record<string, any> = {};
			for (const [key, def] of Object.entries(schemaFile.schema)) {
				if (key === 'file_name' || key === 'last_modified' || key === 'default') continue;
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

			// Only allow schema-defined keys (plus image_name) to be updated here.
			const allowedKeys = new Set(Object.keys(schemaFile.schema));
			allowedKeys.delete('file_name');
			allowedKeys.delete('last_modified');
			allowedKeys.delete('default');
			allowedKeys.delete('id');
			allowedKeys.delete('is_template');
			allowedKeys.delete('width');
			allowedKeys.delete('height');
			allowedKeys.add('image_name');

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
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: 'images', schema: schemaFile.schema });
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
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: 'images', schema: schemaFile.schema });
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
				await writeMediaTypeSettingsFile(paths.baseDir, { kind: 'images', schema: schemaFile.schema });
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
			const safe = assertSafeImageFilename(decoded);
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
		return rec?.file_name ? assertSafeImageFilename(rec.file_name) : null;
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

		if (typeof id === 'string' && id.startsWith('unlinked:')) return;

		await withFileLock(`${paths.imageDataPath}.lock`, async () => {
			const base = await loadAndMigrateImageDataUnlocked();
			const idx = base.images.findIndex((r) => r.id === id);
			if (idx === -1) return;

			const images = base.images.filter((r) => r.id !== id);
			await writeImageData({ images });
		});
	}

	/**
	 * Rename an image file on disk and update its record in image-data.json.
	 *
	 * @param id - Image record id (UUID)
	 * @param newFilename - New filename (validated via assertSafeImageFilename)
	 * @returns Updated ImageRecord
	 * @throws Error if record not found, target exists, or rename fails
	 */
	async function renameFileById(id: ImageId, newFilename: string): Promise<ImageRecord> {
		const safe = assertSafeImageFilename(newFilename);
		const paths = p();

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
			return await withFileLock(`${paths.imageDataPath}.lock`, async () => {
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
		listImages,
		getRecordById,
		getRecordByFilename,
		ensureRecordForFilename,
		getFilenameForId,
		updatePropertiesById,
		unlinkById,
		deleteFromDiskById,
		renameFileById
	};
}

/**
 * Create a repo for a media type by typeId (folder name under root).
 * Returns an image repo or JSON repo depending on the type's kind.
 *
 * @param typeId - Folder name under root (e.g. 'images', 'projects')
 * @returns ImageRepo for kind 'images', JsonRepo for kind 'json'
 */
export function createMediaTypeRepo(typeId: string): ImageRepo | JsonRepo {
	const paths = getMediaTypePaths(typeId);
	if (paths.kind === 'images') return createImageRepo(typeId);
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

