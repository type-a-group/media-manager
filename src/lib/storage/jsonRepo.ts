import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { getMediaTypePaths } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from './settingsFile.js';
import { GLOBALS_RECORD_ID } from './mediaTypes.js';
import { normalizeFieldKey } from './migrate.js';
import {
	isProtectedSchemaKey,
	GLOBALS_FIELD_KINDS_KEY,
	schemaUserFieldKeys
} from '$lib/core/fieldKeys.js';

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
import { type FilterClause, OPERATORS, VALUE_LESS_OPERATORS } from '$lib/core/filters.js';
import type { FieldType } from '$lib/core/types.js';
import { getAvailableFileIds, missingFileFields, missingFilesMap } from './manifest.js';
import { projectRecordRow, stringifyFieldValue } from '$lib/core/recordDisplay.js';
import { sortItems, fieldSortValue, resolveSort, type SortDir } from '$lib/core/sort.js';

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

/**
 * Build a synthetic {@link SchemaDefinition} for the schemaless `globals` record from its reserved
 * `__field_kinds` hint, so schema-driven read logic (url normalization, missing-file detection)
 * applies to globals too. Tolerant of a missing/malformed hint (returns `{}`).
 *
 * Note: only `__field_kinds` is consulted here. The other reserved keys are intentionally ignored —
 * `__field_meta` is per-field UI options (not schema), and `__layout` (the sectioned-editor grouping,
 * see `core/globalsLayout.ts`) is presentation-only. Neither should ever become a synthetic field.
 */
function globalsSyntheticSchema(rec: Record<string, unknown>): SchemaDefinition {
	const raw = rec[GLOBALS_FIELD_KINDS_KEY];
	if (typeof raw !== 'string') return {};
	try {
		const kinds = JSON.parse(raw) as Record<string, unknown>;
		const schema: SchemaDefinition = {};
		for (const [key, kind] of Object.entries(kinds)) {
			if (typeof kind === 'string') schema[key] = { type: kind } as FieldDefinition;
		}
		return schema;
	} catch {
		return {};
	}
}

function evaluateClause(rec: JsonRecord, clause: FilterClause, schema: SchemaDefinition): boolean {
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
	const isGlobalsType = typeId === 'globals';

	const dataPath = paths.dataPath;
	const settingsPath = paths.settingsPath;
	const baseDir = paths.baseDir;

	async function readData(): Promise<JsonDataFile> {
		try {
			const raw = await readJsonFile(dataPath);
			const parsed = JsonDataFileSchema.parse(raw);
			if (!isGlobalsType) return parsed;
			const base =
				parsed.records.find((r) => r.id === GLOBALS_RECORD_ID) ??
				parsed.records[0] ??
				({ id: GLOBALS_RECORD_ID } as JsonRecord);
			const singleton = JsonRecordSchema.parse({
				...base,
				id: GLOBALS_RECORD_ID
			});
			if (parsed.records.length !== 1 || parsed.records[0]?.id !== GLOBALS_RECORD_ID) {
				await writeJsonFileAtomic(dataPath, { records: [singleton] });
			}
			return { records: [singleton] };
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code === 'ENOENT') {
				await fs.mkdir(path.dirname(dataPath), { recursive: true });
				if (isGlobalsType) {
					const singleton = JsonRecordSchema.parse({ id: GLOBALS_RECORD_ID });
					await writeJsonFileAtomic(dataPath, { records: [singleton] });
					return { records: [singleton] };
				}
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
		if (isGlobalsType) return {};
		return settings.schema;
	}

	async function listRecords(params?: {
		filters?: FilterClause[] | null;
		groupBy?: string | null;
		titleField?: string | null;
		subtitleField?: string | null;
		/** Free-text search query (case-insensitive substring). */
		searchQuery?: string | null;
		/**
		 * Field to scope {@link searchQuery} to. `null`/empty = **All fields** (match if any user field's
		 * rendered value contains the query). A field key restricts the match to that one field.
		 */
		searchField?: string | null;
		/**
		 * Sort key (Item 9): a built-in (`name` | `last_modified`) or a schema field key. Falls back to
		 * the persisted per-type `sortField`, then the default `last_modified`.
		 */
		sortField?: string | null;
		/** Sort direction; falls back to the persisted `sortDir`, then `desc`. */
		sortDir?: SortDir | null;
	}): Promise<JsonListResponse> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		const data = await withFileLock(`${dataPath}.lock`, readData);
		let records = data.records;
		if (params?.filters != null && params.filters.length > 0) {
			records = applyFilters(records, params.filters, settings.schema);
		}
		const groupBy = params?.groupBy ?? null;
		// Resolve the effective title field so list rows ALWAYS get a `title_value` and never fall back
		// to a raw id. Precedence: explicit query param → persisted `displayField` → a sensible default
		// (`name` if present, else the first string field, else the first field). The client then trusts
		// `title_value` first — fixing the bug where a present `name` field shadowed the chosen field.
		const defaultTitleField = (() => {
			const keys = Object.keys(settings.schema);
			if (keys.includes('name')) return 'name';
			const firstString = keys.find((k) => settings.schema[k]?.type === 'string');
			return firstString ?? keys[0] ?? null;
		})();
		const titleField = params?.titleField ?? settings.displayField ?? defaultTitleField;
		// Optional persisted subtitle (muted secondary line); explicit query param wins. No default.
		const subtitleField = params?.subtitleField ?? settings.subtitleField ?? null;
		// Only touch the global manifest/disk when the schema actually has `file` fields to validate.
		const hasFileField = Object.values(settings.schema).some((d) => d?.type === 'file');
		const available = hasFileField ? (await getAvailableFileIds()).available : null;

		// Field-scoped (or all-field) text search, applied server-side because list rows carry only
		// derived display values, not raw field data. Reuses the shared `stringifyFieldValue` so
		// url/list/dropdown values match the same way they render in the row.
		const searchQuery = params?.searchQuery?.trim().toLowerCase() ?? '';
		if (searchQuery) {
			const searchField = params?.searchField || null;
			const fieldsToSearch = searchField ? [searchField] : schemaUserFieldKeys(settings.schema);
			records = records.filter((rec) => {
				const recAny = rec as Record<string, unknown>;
				return fieldsToSearch.some((k) =>
					(stringifyFieldValue(settings.schema, k, recAny[k]) ?? '')
						.toLowerCase()
						.includes(searchQuery)
				);
			});
		}

		// Sort (Item 9), server-side so it composes with the filter + search above. `name` sorts by the
		// resolved title field (so a chosen title-by wins); `last_modified` by the record timestamp; any
		// schema field via `fieldSortValue`. Empties sort last; ties break by id. Precedence: explicit
		// param → persisted per-type setting → default (last_modified desc).
		const allowedSort = new Set<string>([
			'name',
			'last_modified',
			...schemaUserFieldKeys(settings.schema)
		]);
		const { field: sortField, dir: sortDir } = resolveSort(
			params?.sortField ?? settings.sortField,
			params?.sortDir ?? settings.sortDir,
			allowedSort,
			{ field: 'last_modified', dir: 'desc' }
		);
		records = sortItems(records, sortDir, {
			value: (rec) => {
				const recAny = rec as Record<string, unknown>;
				if (sortField === 'last_modified') return (recAny.last_modified as string) ?? null;
				if (sortField === 'name')
					return titleField
						? fieldSortValue(settings.schema, titleField, recAny[titleField])
						: ((recAny.name as string) ?? null);
				return fieldSortValue(settings.schema, sortField, recAny[sortField]);
			},
			id: (rec) => rec.id
		});

		const items: JsonListItem[] = records.map((rec) => {
			const recAny = rec as Record<string, unknown>;
			// name/title/subtitle/group are projected by the shared `projectRecordRow` so the client's
			// optimistic post-save row patch renders identically to this server projection.
			const item: JsonListItem = {
				id: rec.id,
				...projectRecordRow(settings.schema, recAny, { titleField, subtitleField, groupBy })
			};
			if (available) {
				const miss = missingFileFields(recAny, settings.schema, available);
				if (miss.length) item.missing_file_fields = miss;
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
		// Globals has no schema — its field UI types live in the reserved `__field_kinds` hint. Build a
		// synthetic schema from it so the same url-normalize + missing-file logic applies.
		const effectiveSchema = isGlobalsType ? globalsSyntheticSchema(out) : settings.schema;
		for (const [key, def] of Object.entries(effectiveSchema)) {
			if (def?.type === 'url' && key in out && out[key] != null) {
				out[key] = normalizeUrlValue(out[key]);
			}
		}
		if (Object.values(effectiveSchema).some((d) => d?.type === 'file')) {
			const { manifest, available } = await getAvailableFileIds();
			const missing = missingFilesMap(out, effectiveSchema, manifest, available);
			if (missing) out._missing_files = missing;
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
				if (k === 'id' || k === 'last_modified') continue;
				if (isGlobalsType) {
					if (v === null) delete next[k];
					else next[k] = v;
				} else if (allowedKeys.has(k)) next[k] = v;
				else if (k in record && v === null) delete next[k];
			}
			if (isGlobalsType) {
				next.id = GLOBALS_RECORD_ID;
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
		if (isGlobalsType) throw new Error('Globals record cannot be deleted');
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
		if (isGlobalsType) throw new Error('Globals supports exactly one record');
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
		multiselect?: boolean
	) {
		if (isGlobalsType) throw new Error('Schema is not editable for globals');
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
				...(parsedType === 'list' && itemTypes?.length ? { itemTypes } : {})
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
		}
	) {
		if (isGlobalsType) throw new Error('Schema is not editable for globals');
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
			const multiselect =
				type === 'dropdown'
					? (updates.multiselect ?? (def as { multiselect?: boolean }).multiselect ?? false)
					: false;

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
							if (!options.includes(String(v)))
								throw new Error('Default value items must be in options');
						}
					}
				} else {
					if (!options.includes(String(defaultValue)))
						throw new Error('Default value must be one of the options');
				}
			}
			if (type === 'list' && defaultValue !== undefined && !Array.isArray(defaultValue)) {
				throw new Error('List default must be an array');
			}

			const schema = { ...settings.schema };

			delete schema[key];
			schema[newKey] = {
				type,
				removable: def.removable,
				defaultValue: defaultValue as never,
				...(options?.length ? { options } : {}),
				...(type === 'list' && itemTypes?.length ? { itemTypes } : {}),
				...(type === 'dropdown' && multiselect ? { multiselect: true } : {})
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
		if (isGlobalsType) throw new Error('Schema is not editable for globals');
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

	/**
	 * Compute the default value for a schema field definition (mirrors createRecord defaults).
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
	 * @param patch - Property patch applied to each
	 * @returns The updated records
	 */
	async function bulkUpdatePropertiesByIds(
		ids: ImageId[],
		patch: Record<string, unknown>
	): Promise<JsonRecord[]> {
		const out: JsonRecord[] = [];
		for (const id of ids) {
			out.push(await updatePropertiesById(id, patch));
		}
		return out;
	}

	/**
	 * Delete many records in one call.
	 *
	 * @param ids - Record ids to delete
	 */
	async function bulkDeleteRecordsByIds(ids: ImageId[]): Promise<void> {
		if (isGlobalsType) throw new Error('Globals record cannot be deleted');
		await withFileLock(`${dataPath}.lock`, async () => {
			const data = await readData();
			const toRemove = new Set(ids);
			const records = data.records.filter((r) => !toRemove.has(r.id));
			await writeJsonFileAtomic(dataPath, { records });
		});
	}

	/**
	 * Scan all records against the current schema and report records missing schema-defined fields.
	 * Missing fields are filled with the field's default value.
	 *
	 * @param dryRun - When true, only report issues; when false, persist fixes
	 * @returns Issues found and number of records modified (0 on dry run)
	 */
	async function repairRecords(dryRun = true): Promise<{
		issues: { id: string; field: string; issue: string; fix?: unknown }[];
		fixed: number;
	}> {
		const settings = getSettings();
		if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
		const schema = settings.schema;
		return await withFileLock(`${dataPath}.lock`, async () => {
			const data = await readData();
			const issues: { id: string; field: string; issue: string; fix?: unknown }[] = [];
			let fixed = 0;
			const records = data.records.map((rec) => {
				const recAny = rec as Record<string, unknown>;
				const next: Record<string, unknown> = { ...recAny };
				let recChanged = false;
				for (const [key, def] of Object.entries(schema)) {
					if (recAny[key] === undefined) {
						const fix = defaultForFieldDef(def as never);
						issues.push({ id: rec.id as string, field: key, issue: 'Missing value', fix });
						if (!dryRun) {
							next[key] = fix;
							recChanged = true;
						}
					}
				}
				if (recChanged) {
					fixed++;
					return JsonRecordSchema.parse(next);
				}
				return rec;
			});
			if (!dryRun && fixed > 0) await writeJsonFileAtomic(dataPath, { records });
			return { issues, fixed };
		});
	}

	/**
	 * Replace this media type's entire schema (used by schema import and clone-from-type).
	 * Validates the incoming definition, persists it, then backfills defaults for newly added fields.
	 *
	 * @param schema - Full schema definition to apply
	 * @returns The validated schema that was written
	 */
	async function importSchema(schema: SchemaDefinition): Promise<{ schema: SchemaDefinition }> {
		if (isGlobalsType) throw new Error('Schema is not editable for globals');
		return await withFileLock(`${settingsPath}.lock`, async () => {
			const settings = getSettings();
			if (!settings) throw new Error(`Not a valid media-type folder: ${typeId}`);
			await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });
			await withFileLock(`${dataPath}.lock`, async () => {
				const data = await readData();
				const records = data.records.map((rec) => {
					const next = { ...(rec as Record<string, unknown>) };
					for (const [key, def] of Object.entries(schema)) {
						if (next[key] === undefined) next[key] = defaultForFieldDef(def as never);
					}
					return JsonRecordSchema.parse(next);
				});
				await writeJsonFileAtomic(dataPath, { records });
			});
			return { schema };
		});
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
		bulkUpdatePropertiesByIds,
		deleteRecord,
		bulkDeleteRecordsByIds,
		createRecord,
		repairRecords,
		addSchemaField,
		updateSchemaField,
		deleteSchemaField,
		importSchema,
		getUniqueFieldValues
	};
}

export type JsonRepo = ReturnType<typeof createJsonRepoForType>;
