import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { getMediaTypePaths } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import {
	readMediaTypeSettingsFileSync,
	writeMediaTypeSettingsFile
} from './settingsFile.js';
import { normalizeFieldKey } from './migrate.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';

import type { SchemaDefinition, FieldDefinition } from '$lib/core/types.js';
import {
	JsonRecordSchema,
	JsonDataFileSchema,
	type JsonRecord,
	type JsonDataFile,
	type JsonListItem,
	type JsonListResponse,
	normalizeUrlValue
} from '$lib/core/types.js';
import { newImageId, type ImageId } from '$lib/core/ids.js';
import {
	type FilterClause,
	OPERATORS,
	VALUE_LESS_OPERATORS
} from '$lib/core/filters.js';
import type { FieldType } from '$lib/core/types.js';

/**
 * JSON media-type repository: read/write records and schema from a single data file and settings.
 *
 * Use case:
 * - Pure JSON media types (e.g. projects list) with no file attachments; schema and app settings in settings.json.
 *
 * Concerns / future improvements:
 * - Filter logic is duplicated from image repo; could be extracted to shared module.
 */

function getFieldType(schema: SchemaDefinition, fieldKey: string): FieldType {
	const def = schema[fieldKey];
	if (def?.type) return def.type as FieldType;
	return 'string';
}

function evaluateClause(
	rec: JsonRecord,
	clause: FilterClause,
	schema: SchemaDefinition
): boolean {
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

function applyFilters(
	records: JsonRecord[],
	filters: FilterClause[],
	schema: SchemaDefinition
): JsonRecord[] {
	if (!filters.length) return records;
	return records.filter((rec) => filters.every((c) => evaluateClause(rec, c, schema)));
}

/**
 * Create a repo for a JSON media type (by typeId).
 *
 * @param typeId - Folder name under root (e.g. 'projects')
 */
export function createJsonRepoForType(typeId: string) {
	const paths = getMediaTypePaths(typeId);
	if (paths.kind !== 'json') throw new Error(`Media type ${typeId} is not JSON`);

	const dataPath = paths.dataPath;
	const settingsPath = paths.settingsPath;
	const baseDir = paths.baseDir;

	async function readData(): Promise<JsonDataFile> {
		try {
			const raw = await readJsonFile(dataPath);
			const parsed = JsonDataFileSchema.parse(raw);
			return parsed;
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code === 'ENOENT') {
				await fs.mkdir(path.dirname(dataPath), { recursive: true });
				await writeJsonFileAtomic(dataPath, { records: [] });
				return { records: [] };
			}
			throw err;
		}
	}

	function getSettings() {
		const s = readMediaTypeSettingsFileSync(baseDir);
		if (!s) return null;
		if (!s.schema) s.schema = {};
		return s as Omit<typeof s, 'schema'> & { schema: SchemaDefinition };
	}

	async function getSchema(): Promise<SchemaDefinition> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		return settings.schema;
	}

	async function listRecords(params?: {
		filters?: FilterClause[] | null;
		groupBy?: string | null;
	}): Promise<JsonListResponse> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		const data = await withFileLock(`${dataPath}.lock`, readData);
		let records = data.records;
		if (params?.filters != null && params.filters.length > 0) {
			records = applyFilters(records, params.filters, settings.schema);
		}
		const groupBy = params?.groupBy ?? null;
		const items: JsonListItem[] = records.map((rec) => {
			const recAny = rec as Record<string, unknown>;
			const item: JsonListItem = { id: rec.id };
			// Include name for list/grid display when present (e.g. default "name" field).
			if (typeof recAny.name === 'string') item.name = recAny.name;
			if (groupBy) {
				const val = recAny[groupBy];
				const def = settings.schema[groupBy];
				if (def?.type === 'url' && val != null) {
					const urlVal = normalizeUrlValue(val);
					item.group_by_value = (urlVal.display_name ?? '').trim() || urlVal.url || '';
				} else if (def?.type === 'list' && Array.isArray(val)) {
					item.group_by_value = val
						.map((item: unknown) =>
							item != null && typeof item === 'object' && 'url' in (item as object)
								? ((item as { display_name?: string; url?: string }).display_name ?? '').trim() ||
								(item as { url: string }).url ||
								''
								: String(item)
						)
						.join(', ');
				} else if (def?.type === 'dropdown' && (def as { multiselect?: boolean }).multiselect && Array.isArray(val)) {
					item.group_by_value = (val as string[]).join(', ');
				} else if (
					val === null ||
					typeof val === 'string' ||
					typeof val === 'number' ||
					typeof val === 'boolean' ||
					Array.isArray(val)
				) {
					item.group_by_value = val;
				}
			}
			return item;
		});
		return { records: items };
	}

	/**
	 * Returns a record by id. URL fields are normalized to { display_name, url } so legacy string values appear as objects.
	 */
	async function getRecordById(id: ImageId): Promise<JsonRecord | null> {
		const data = await readData();
		const rec = data.records.find((r) => r.id === id) ?? null;
		if (!rec) return null;
		const settings = getSettings();
		if (!settings) return rec;
		const out = { ...rec } as Record<string, unknown>;
		for (const [key, def] of Object.entries(settings.schema)) {
			if (def?.type === 'url' && key in out && out[key] != null) {
				out[key] = normalizeUrlValue(out[key]);
			}
		}
		return out as JsonRecord;
	}

	async function updatePropertiesById(
		id: ImageId,
		patch: Record<string, unknown>
	): Promise<JsonRecord> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		const allowedKeys = new Set(Object.keys(settings.schema));
		allowedKeys.delete('id');
		allowedKeys.delete('last_modified');

		return await withFileLock(`${dataPath}.lock`, async () => {
			const data = await readData();
			const idx = data.records.findIndex((r) => r.id === id);
			if (idx === -1) throw new Error('Record not found');
			const record = data.records[idx] as Record<string, unknown>;
			const next = { ...record };
			for (const [k, v] of Object.entries(patch)) {
				if (allowedKeys.has(k)) next[k] = v;
				else if (k in record && v === null) delete next[k];
			}
			(next as JsonRecord).last_modified = new Date().toISOString();
			const parsed = JsonRecordSchema.parse(next);
			const records = [...data.records];
			records[idx] = parsed;
			await writeJsonFileAtomic(dataPath, { records });
			return parsed;
		});
	}

	/**
	 * Remove a record from the data file.
	 */
	async function deleteRecord(id: ImageId): Promise<void> {
		await withFileLock(`${dataPath}.lock`, async () => {
			const data = await readData();
			const idx = data.records.findIndex((r) => r.id === id);
			if (idx === -1) throw new Error('Record not found');
			const records = data.records.filter((r) => r.id !== id);
			await writeJsonFileAtomic(dataPath, { records });
		});
	}

	/**
	 * Create a new record with schema defaults and append to data file.
	 */
	async function createRecord(): Promise<JsonRecord> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		const defaults: Record<string, unknown> = {};
		for (const [key, def] of Object.entries(settings.schema)) {
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
		const record = JsonRecordSchema.parse({
			id: newImageId(),
			last_modified: new Date().toISOString(),
			...defaults
		});
		await withFileLock(`${dataPath}.lock`, async () => {
			const data = await readData();
			await writeJsonFileAtomic(dataPath, { records: [...data.records, record] });
		});
		return record;
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

		return await withFileLock(`${settingsPath}.lock`, async () => {
			const settings = getSettings();
			if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
			const schema = { ...settings.schema };
			schema[key] = {
				type: parsedType,
				removable: true,
				defaultValue: defaultValue as never,
				...(parsedType === 'dropdown' && options?.length ? { options } : {}),
				...(parsedType === 'dropdown' && multiselect ? { multiselect: true } : {}),
				...(parsedType === 'list' && itemTypes?.length ? { itemTypes } : {}),
				...(parsedType === 'string' && long ? { long: true } : {})
			} as FieldDefinition;
			await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });

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
			await withFileLock(`${dataPath}.lock`, async () => {
				const data = await readData();
				const records = data.records.map((rec) => {
					const next = { ...rec } as Record<string, unknown>;
					if (next[key] === undefined) next[key] = defaultVal;
					return JsonRecordSchema.parse(next);
				});
				await writeJsonFileAtomic(dataPath, { records });
			});
			return { schema };
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

		return await withFileLock(`${settingsPath}.lock`, async () => {
			const settings = getSettings();
			if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
			const def = settings.schema[key];
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
					if (!options.includes(String(defaultValue))) throw new Error('Default value must be one of the options');
				}
			}
			if (type === 'list' && defaultValue !== undefined && !Array.isArray(defaultValue)) {
				throw new Error('List default must be an array');
			}

			const schema = { ...settings.schema };
			const long = type === 'string' ? (updates.long ?? (def as any).long ?? false) : false;

			delete schema[key];
			schema[newKey] = {
				type,
				removable: def.removable,
				defaultValue: defaultValue as never,
				...(options?.length ? { options } : {}),
				...(type === 'list' && itemTypes?.length ? { itemTypes } : {}),
				...(type === 'dropdown' && multiselect ? { multiselect: true } : {}),
				...(type === 'string' && long ? { long: true } : {})
			} as FieldDefinition;
			await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });

			if (newKey !== key) {
				await withFileLock(`${dataPath}.lock`, async () => {
					const data = await readData();
					const records = data.records.map((rec) => {
						const next = { ...rec } as Record<string, unknown>;
						if (key in next) {
							next[newKey] = next[key];
							delete next[key];
						}
						return JsonRecordSchema.parse(next);
					});
					await writeJsonFileAtomic(dataPath, { records });
				});
			} else if (wasMultiselect && !multiselect) {
				await withFileLock(`${dataPath}.lock`, async () => {
					const data = await readData();
					const records = data.records.map((rec) => {
						const next = { ...rec } as Record<string, unknown>;
						const val = next[newKey];
						if (Array.isArray(val)) next[newKey] = val[0] ?? '';
						return JsonRecordSchema.parse(next);
					});
					await writeJsonFileAtomic(dataPath, { records });
				});
			}
			return { schema };
		});
	}

	async function deleteSchemaField(fieldName: string, removeFromRecords?: boolean) {
		const key = normalizeFieldKey(fieldName);
		if (isProtectedSchemaKey(key)) throw new Error('Field not removable');

		return await withFileLock(`${settingsPath}.lock`, async () => {
			const settings = getSettings();
			if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
			const def = settings.schema[key];
			if (!def) throw new Error('Field not found');
			if (def.removable === false) throw new Error('Field not removable');
			const schema = { ...settings.schema };
			delete schema[key];
			await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });

			if (removeFromRecords) {
				await withFileLock(`${dataPath}.lock`, async () => {
					const data = await readData();
					const records = data.records.map((rec) => {
						const next = { ...rec } as Record<string, unknown>;
						delete next[key];
						return JsonRecordSchema.parse(next);
					});
					await writeJsonFileAtomic(dataPath, { records });
				});
			}
			return { schema };
		});
	}

	async function getUniqueFieldValues(fieldName: string): Promise<string[]> {
		const data = await readData();
		const seen = new Set<string>();
		const itemToStr = (item: unknown): string => {
			if (item != null && typeof item === 'object' && 'url' in (item as object)) {
				const o = item as { display_name?: string; url?: string };
				return (o.display_name ?? '').trim() || (o.url ?? '').trim();
			}
			return String(item).trim();
		};
		for (const rec of data.records) {
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

	return {
		get paths() {
			return getMediaTypePaths(typeId);
		},
		getSettings,
		getSchema,
		listRecords,
		getRecordById,
		updatePropertiesById,
		deleteRecord,
		createRecord,
		addSchemaField,
		updateSchemaField,
		deleteSchemaField,
		getUniqueFieldValues
	};
}

export type JsonRepo = ReturnType<typeof createJsonRepoForType>;
