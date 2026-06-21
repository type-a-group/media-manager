import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import {
	getClassFilePath,
	getClassesDir,
	getGlobalFilesDir,
	getManifestPath,
	listClassIds
} from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import { assertSafeBasename } from './filenames.js';
import { normalizeFieldKey } from './migrate.js';
import { isProtectedSchemaKey, schemaUserFieldKeys } from '$lib/core/fieldKeys.js';
import { readImageDimensions } from '$lib/server/fileMetadata.js';
import {
	readManifest,
	reconcile,
	mintFileId,
	renameFileId as manifestRenameFileId,
	removeFileId,
	setClassMembership,
	removeClassFromIndex,
	applyMembershipIndex,
	setEntryDimensions,
	availableFromManifest,
	missingFileFields,
	missingFilesMap,
	getAvailableFileIds,
	readGlobalBlobNames,
	type Manifest
} from './manifest.js';

import {
	ClassFileSchema,
	JsonRecordSchema,
	normalizeUrlValue,
	type ClassFile,
	type ClassSummary,
	type FileItem,
	type FileListResponse,
	type JsonRecord,
	type SchemaDefinition
} from '$lib/core/types.js';
import { hasAllowedImageExtension } from '$lib/core/images.js';
import { type FilterClause, OPERATORS, VALUE_LESS_OPERATORS } from '$lib/core/filters.js';
import type { FieldType } from '$lib/core/types.js';

/**
 * File-first class storage. A **class** is a schema + opt-in per-blob metadata stored as a single
 * source-of-truth file (`media/classes/<id>.json` = `{ schema, config, records }`), with `records`
 * keyed by the blob's manifest `file_id`. Membership is binary (member / not-member): a blob is a
 * member iff the class file has a record for its id. There is no linked/unlinked/excluded tri-state.
 *
 * The global blob store (`media/files/`) and its manifest are the primary entity; classes sit on top.
 * All Files listing is manifest-driven; a one-class listing is just the class's records as a catalog.
 */

/** Class id guard: filename-safe stem, no traversal (mirrors the API-layer regex). */
function assertSafeClassId(id: string): string {
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid class id: ${id}`);
	return id;
}

function classLockPath(id: string): string {
	return `${getClassFilePath(id)}.lock`;
}

/** Whether a class file exists on disk. */
export function classExists(id: string): boolean {
	return fssync.existsSync(getClassFilePath(assertSafeClassId(id)));
}

/** Read + validate a class file. Throws if the class does not exist. */
export async function readClassFile(id: string): Promise<ClassFile> {
	assertSafeClassId(id);
	const raw = await readJsonFile(getClassFilePath(id)).catch((err) => {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') throw new Error(`Class not found: ${id}`);
		throw err;
	});
	return ClassFileSchema.parse(raw);
}

async function writeClassFile(id: string, file: ClassFile): Promise<void> {
	await fs.mkdir(getClassesDir(), { recursive: true });
	await writeJsonFileAtomic(getClassFilePath(id), ClassFileSchema.parse(file));
}

/** Slugify a display name into a class id (fixed at creation). */
function slugify(displayName: string): string {
	return (
		displayName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'class'
	);
}

// ---------------------------------------------------------------------------
// Class management
// ---------------------------------------------------------------------------

/** List every class with its display name and member count. */
export function listClasses(): ClassSummary[] {
	const out: ClassSummary[] = [];
	for (const id of listClassIds()) {
		try {
			const raw = JSON.parse(fssync.readFileSync(getClassFilePath(id), 'utf-8')) as {
				config?: { displayName?: string };
				records?: Record<string, unknown>;
			};
			out.push({
				id,
				displayName: raw.config?.displayName || id,
				count: raw.records ? Object.keys(raw.records).length : 0
			});
		} catch {
			/* skip corrupt class file */
		}
	}
	return out;
}

/**
 * Create a new class. The id is the slug of `displayName`, fixed at creation; a numeric suffix is
 * appended on collision. An empty schema is allowed (a pure-tag class).
 *
 * @returns The new class id.
 */
export async function createClass(
	displayName: string,
	schema: SchemaDefinition = {}
): Promise<string> {
	let base = slugify(displayName);
	let id = base;
	let n = 1;
	while (fssync.existsSync(getClassFilePath(id))) {
		id = `${base}-${n}`;
		n++;
	}
	await writeClassFile(id, {
		schema,
		config: { displayName: displayName.trim() || id },
		records: {}
	});
	return id;
}

/** Delete a class: remove its file and strip its id from the manifest membership index. Blobs untouched. */
export async function deleteClass(id: string): Promise<void> {
	assertSafeClassId(id);
	await withFileLock(classLockPath(id), async () => {
		await fs.rm(getClassFilePath(id), { force: true });
	});
	await removeClassFromIndex(id);
}

/** Update a class's config (display name, grid prefs). */
export async function updateClassConfig(
	id: string,
	patch: Partial<ClassFile['config']>
): Promise<ClassFile['config']> {
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const config = { ...file.config, ...patch };
		await writeClassFile(id, { ...file, config });
		return config;
	});
}

// ---------------------------------------------------------------------------
// Schema editing (per class)
// ---------------------------------------------------------------------------

/** Compute the default value for a schema field definition. */
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
		case 'file':
			return '';
		default:
			return '';
	}
}

export async function getClassSchema(id: string): Promise<SchemaDefinition> {
	return (await readClassFile(id)).schema;
}

const SchemaFieldTypeSchema = z.enum([
	'string',
	'number',
	'boolean',
	'dropdown',
	'list',
	'url',
	'file'
]);

export async function addSchemaField(
	id: string,
	fieldName: string,
	fieldType: string,
	defaultValue: unknown,
	options?: string[],
	itemTypes?: string[],
	multiselect?: boolean
): Promise<{ schema: SchemaDefinition }> {
	const parsedType = SchemaFieldTypeSchema.parse(fieldType);
	const key = normalizeFieldKey(fieldName);
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
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
		const schema = { ...file.schema, [key]: def };
		const fill = defaultForFieldDef(def);
		const records = applyToRecords(file.records, (rec) =>
			rec[key] === undefined ? { ...rec, [key]: fill } : rec
		);
		await writeClassFile(id, { ...file, schema, records });
		return { schema };
	});
}

export async function updateSchemaField(
	id: string,
	oldKey: string,
	updates: {
		newKey?: string;
		type?: string;
		defaultValue?: unknown;
		options?: string[];
		itemTypes?: string[];
		multiselect?: boolean;
	}
): Promise<{ schema: SchemaDefinition }> {
	const key = normalizeFieldKey(oldKey);
	if (isProtectedSchemaKey(key)) throw new Error('Field not modifiable');
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const def = file.schema[key];
		if (!def) throw new Error('Field not found');

		const newKey = updates.newKey ? normalizeFieldKey(updates.newKey) : key;
		if (newKey !== key && isProtectedSchemaKey(newKey)) throw new Error('Field not modifiable');

		const type = (updates.type ? SchemaFieldTypeSchema.parse(updates.type) : def.type) as FieldType;
		const wasMultiselect = (def as { multiselect?: boolean }).multiselect === true;
		const multiselect =
			type === 'dropdown'
				? (updates.multiselect ?? (def as { multiselect?: boolean }).multiselect ?? false)
				: false;

		let defaultValue = updates.defaultValue ?? def.defaultValue;
		if (type === 'url' && typeof defaultValue === 'string')
			defaultValue = normalizeUrlValue(defaultValue);
		if (type === 'dropdown' && wasMultiselect && !multiselect && Array.isArray(defaultValue)) {
			defaultValue = defaultValue[0] ?? '';
		}
		const options = updates.options ?? def.options;
		const itemTypes = updates.itemTypes ?? (def as { itemTypes?: string[] }).itemTypes;

		const schema = { ...file.schema };
		delete schema[key];
		schema[newKey] = {
			type,
			removable: def.removable,
			defaultValue: defaultValue as never,
			...(options?.length ? { options } : {}),
			...(type === 'list' && itemTypes?.length ? { itemTypes: itemTypes as never } : {}),
			...(type === 'dropdown' && multiselect ? { multiselect: true } : {})
		};

		let records = file.records;
		if (newKey !== key) {
			records = applyToRecords(records, (rec) => {
				if (!(key in rec)) return rec;
				const next = { ...rec, [newKey]: rec[key] };
				delete next[key];
				return next;
			});
		} else if (wasMultiselect && !multiselect) {
			records = applyToRecords(records, (rec) => {
				const v = rec[newKey];
				return Array.isArray(v) ? { ...rec, [newKey]: v[0] ?? '' } : rec;
			});
		}
		await writeClassFile(id, { ...file, schema, records });
		return { schema };
	});
}

export async function deleteSchemaField(
	id: string,
	fieldName: string,
	removeFromRecords?: boolean
): Promise<{ schema: SchemaDefinition }> {
	const key = normalizeFieldKey(fieldName);
	if (isProtectedSchemaKey(key)) throw new Error('Field not removable');
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const def = file.schema[key];
		if (!def) throw new Error('Field not found');
		if (def.removable === false) throw new Error('Field not removable');
		const schema = { ...file.schema };
		delete schema[key];
		const records = removeFromRecords
			? applyToRecords(file.records, (rec) => {
					const next = { ...rec };
					delete next[key];
					return next;
				})
			: file.records;
		await writeClassFile(id, { ...file, schema, records });
		return { schema };
	});
}

/** Replace a class's entire schema, backfilling defaults into existing records. */
export async function importSchema(
	id: string,
	schema: SchemaDefinition
): Promise<{ schema: SchemaDefinition }> {
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const records = applyToRecords(file.records, (rec) => {
			const next = { ...rec };
			let changed = false;
			for (const [k, def] of Object.entries(schema)) {
				if (next[k] === undefined) {
					next[k] = defaultForFieldDef(def) as never;
					changed = true;
				}
			}
			return changed ? next : rec;
		});
		await writeClassFile(id, { ...file, schema, records });
		return { schema };
	});
}

/** Map over a records object, preserving identity when unchanged. */
function applyToRecords(
	records: Record<string, JsonRecord>,
	fn: (rec: Record<string, unknown>) => Record<string, unknown>
): Record<string, JsonRecord> {
	const out: Record<string, JsonRecord> = {};
	for (const [fileId, rec] of Object.entries(records)) {
		out[fileId] = JsonRecordSchema.parse(fn(rec as Record<string, unknown>));
	}
	return out;
}

// ---------------------------------------------------------------------------
// Membership + per-record metadata
// ---------------------------------------------------------------------------

/** Build a blank record (schema defaults) for a newly-added member. */
function blankRecord(fileId: string, schema: SchemaDefinition): JsonRecord {
	const rec: Record<string, unknown> = { id: fileId, last_modified: new Date().toISOString() };
	for (const [key, def] of Object.entries(schema)) {
		if (key === 'id' || key === 'last_modified') continue;
		rec[key] = defaultForFieldDef(def);
	}
	return JsonRecordSchema.parse(rec);
}

/**
 * Add blobs to a class, creating empty member records (fields filled later inline). Existing members
 * are left untouched. Updates the manifest membership index.
 *
 * @returns The created/existing records.
 */
export async function addMembers(id: string, fileIds: string[]): Promise<JsonRecord[]> {
	const result = await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const records = { ...file.records };
		const added: string[] = [];
		const out: JsonRecord[] = [];
		for (const fileId of fileIds) {
			if (records[fileId]) {
				out.push(records[fileId]);
				continue;
			}
			const rec = blankRecord(fileId, file.schema);
			records[fileId] = rec;
			added.push(fileId);
			out.push(rec);
		}
		if (added.length) await writeClassFile(id, { ...file, records });
		return { added, out };
	});
	for (const fileId of result.added) await setClassMembership(fileId, id, true);
	return result.out;
}

/** Remove blobs from a class (drops their member records). Updates the manifest membership index. */
export async function removeMembers(id: string, fileIds: string[]): Promise<void> {
	const removed = await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const records = { ...file.records };
		const removed: string[] = [];
		for (const fileId of fileIds) {
			if (records[fileId]) {
				delete records[fileId];
				removed.push(fileId);
			}
		}
		if (removed.length) await writeClassFile(id, { ...file, records });
		return removed;
	});
	for (const fileId of removed) await setClassMembership(fileId, id, false);
}

/**
 * Get one blob's record in a class (null if not a member), with url fields normalized, the resolved
 * `file_name` attached, and `_missing_files` annotated for broken `file`-field references.
 */
export async function getRecord(id: string, fileId: string): Promise<JsonRecord | null> {
	const file = await readClassFile(id);
	const rec = file.records[fileId];
	if (!rec) return null;
	const { manifest, available } = await getAvailableFileIds();
	const out = { ...(rec as Record<string, unknown>) };
	out.file_name = manifest.files[fileId]?.file_name ?? '';
	for (const [key, def] of Object.entries(file.schema)) {
		if (def?.type === 'url' && key in out && out[key] != null)
			out[key] = normalizeUrlValue(out[key]);
	}
	const missing = missingFilesMap(out, file.schema, manifest, available);
	if (missing) out._missing_files = missing;
	return out as JsonRecord;
}

/** Update a member's metadata fields (schema-defined keys only; null removes orphan keys). */
export async function updateRecord(
	id: string,
	fileId: string,
	patch: Record<string, unknown>
): Promise<JsonRecord> {
	return await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const rec = file.records[fileId];
		if (!rec) throw new Error('Not a member of this class');
		const allowed = new Set(Object.keys(file.schema));
		allowed.delete('id');
		allowed.delete('last_modified');
		const next: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
		for (const [k, v] of Object.entries(patch)) {
			if (allowed.has(k)) next[k] = v;
			else if (k in next && k !== 'id' && k !== 'last_modified' && v === null) delete next[k];
		}
		next.last_modified = new Date().toISOString();
		const parsed = JsonRecordSchema.parse(next);
		await writeClassFile(id, { ...file, records: { ...file.records, [fileId]: parsed } });
		return parsed;
	});
}

/** Bulk-set the same fields on many members of a class. */
export async function bulkUpdateRecords(
	id: string,
	fileIds: string[],
	patch: Record<string, unknown>
): Promise<void> {
	await withFileLock(classLockPath(id), async () => {
		const file = await readClassFile(id);
		const allowed = new Set(Object.keys(file.schema));
		allowed.delete('id');
		allowed.delete('last_modified');
		const records = { ...file.records };
		for (const fileId of fileIds) {
			const rec = records[fileId];
			if (!rec) continue;
			const next: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
			for (const [k, v] of Object.entries(patch)) {
				if (allowed.has(k)) next[k] = v;
				else if (k in next && v === null) delete next[k];
			}
			next.last_modified = new Date().toISOString();
			records[fileId] = JsonRecordSchema.parse(next);
		}
		await writeClassFile(id, { ...file, records });
	});
}

/** Unique non-empty values for a field across a class's members (for filter/dropdown suggestions). */
export async function getUniqueFieldValues(id: string, fieldName: string): Promise<string[]> {
	const file = await readClassFile(id);
	const seen = new Set<string>();
	const itemToStr = (item: unknown): string => {
		if (item != null && typeof item === 'object' && 'url' in (item as object)) {
			const o = item as { display_name?: string; url?: string };
			return (o.display_name ?? '').trim() || (o.url ?? '').trim();
		}
		return String(item).trim();
	};
	for (const rec of Object.values(file.records)) {
		const v = (rec as Record<string, unknown>)[fieldName];
		if (v === undefined || v === null) continue;
		if (Array.isArray(v)) {
			for (const item of v) {
				const s = itemToStr(item);
				if (s) seen.add(s);
			}
		} else if (typeof v === 'string' && v.trim()) seen.add(v.trim());
		else if (v != null && typeof v === 'object' && 'url' in v) {
			const s = itemToStr(v);
			if (s) seen.add(s);
		} else if (typeof v === 'number' && !Number.isNaN(v)) seen.add(String(v));
	}
	return [...seen].sort();
}

// ---------------------------------------------------------------------------
// Filtering (shared with the one-class catalog view)
// ---------------------------------------------------------------------------

function getFieldType(schema: SchemaDefinition, fieldKey: string): FieldType {
	return (schema[fieldKey]?.type as FieldType) ?? 'string';
}

function evaluateClause(
	rec: Record<string, unknown>,
	clause: FilterClause,
	schema: SchemaDefinition
): boolean {
	const { field, operator, value } = clause;
	const raw = rec[field];
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
		return operator === OPERATORS.equals ? bool === target : false;
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

function groupByValue(
	rec: Record<string, unknown>,
	schema: SchemaDefinition,
	groupBy: string
): string | number | boolean | string[] | null {
	const val = rec[groupBy];
	const def = schema[groupBy];
	if (val === undefined || val === null) return null;
	if (def?.type === 'url') {
		const urlVal = normalizeUrlValue(val);
		return (urlVal.display_name ?? '').trim() || urlVal.url || '';
	}
	if (def?.type === 'list' && Array.isArray(val)) {
		return val
			.map((item: unknown) =>
				item != null && typeof item === 'object' && 'url' in (item as object)
					? ((item as { display_name?: string; url?: string }).display_name ?? '').trim() ||
						(item as { url: string }).url ||
						''
					: String(item)
			)
			.join(', ');
	}
	if (
		def?.type === 'dropdown' &&
		(def as { multiselect?: boolean }).multiselect &&
		Array.isArray(val)
	) {
		return (val as string[]).join(', ');
	}
	return val as string | number | boolean | string[];
}

/**
 * Lowercased searchable text for one field of a class record, reusing {@link groupByValue} so
 * url/list/dropdown values are matched the same way they group/render. Empty string when absent.
 */
function fieldSearchText(
	rec: Record<string, unknown>,
	schema: SchemaDefinition,
	field: string
): string {
	const v = groupByValue(rec, schema, field);
	if (v == null) return '';
	return (Array.isArray(v) ? v.join(', ') : String(v)).toLowerCase();
}

// ---------------------------------------------------------------------------
// Reconcile + dimension backfill helpers (shared by both listings)
// ---------------------------------------------------------------------------

/** Reconcile the manifest against disk and resync the membership index if any class file is stale. */
async function reconcileAndResync(): Promise<{
	manifest: Manifest;
	diskNames: Set<string>;
	healed: { added: number; missing: number };
}> {
	const diskNames = await readGlobalBlobNames();
	const { added, missing, manifest } = await reconcile(diskNames);

	// mtime-gated resync: if any class file is newer than the manifest, rebuild membership from classes.
	let resynced = manifest;
	let manifestMtime = 0;
	try {
		manifestMtime = fssync.statSync(getManifestPath()).mtimeMs;
	} catch {
		/* manifest not written yet → treat everything as stale */
	}
	let stale = false;
	for (const cid of listClassIds()) {
		try {
			if (fssync.statSync(getClassFilePath(cid)).mtimeMs > manifestMtime) {
				stale = true;
				break;
			}
		} catch {
			/* ignore */
		}
	}
	if (stale) {
		const membership = new Map<string, Set<string>>();
		for (const cid of listClassIds()) {
			try {
				const raw = JSON.parse(fssync.readFileSync(getClassFilePath(cid), 'utf-8')) as {
					records?: Record<string, unknown>;
				};
				for (const fileId of Object.keys(raw.records ?? {})) {
					if (!membership.has(fileId)) membership.set(fileId, new Set());
					membership.get(fileId)!.add(cid);
				}
			} catch {
				/* skip */
			}
		}
		resynced = await applyMembershipIndex(membership);
	}

	return {
		manifest: resynced,
		diskNames: new Set(diskNames),
		healed: { added: added.length, missing: missing.length }
	};
}

/** Backfill intrinsic image dimensions into the manifest for on-disk image blobs lacking them. */
async function backfillDimensions(manifest: Manifest, diskNames: Set<string>): Promise<void> {
	const filesDir = getGlobalFilesDir();
	const dims = new Map<string, { width?: number; height?: number }>();
	for (const [id, entry] of Object.entries(manifest.files)) {
		if (entry.width != null || entry.height != null) continue;
		if (!diskNames.has(entry.file_name)) continue;
		if (!hasAllowedImageExtension(entry.file_name)) continue;
		try {
			const d = await readImageDimensions(path.join(filesDir, entry.file_name));
			if (d.width != null || d.height != null) {
				dims.set(id, d);
				entry.width = d.width;
				entry.height = d.height;
			}
		} catch {
			/* skip */
		}
	}
	await setEntryDimensions(dims);
}

function fileItemFromEntry(id: string, manifest: Manifest): FileItem {
	const e = manifest.files[id];
	return {
		id,
		file_name: e?.file_name ?? '',
		classes: e?.classes ?? [],
		missing: e?.missing ?? false,
		size: e?.size,
		created_at: e?.created_at,
		width: e?.width,
		height: e?.height
	};
}

// ---------------------------------------------------------------------------
// All Files listing (manifest-driven)
// ---------------------------------------------------------------------------

/**
 * The Files hub home: every blob in the store, with derived class chips. Supports a filename search,
 * class filter (`classIds`, ANY/ALL), and the lone built-in `unclassified` pseudo-filter.
 */
export async function listAllFiles(params?: {
	query?: string | null;
	classIds?: string[] | null;
	matchAll?: boolean;
	unclassified?: boolean;
	/**
	 * Group the result by one class's field (the multi-class "all of" view): each item gets a
	 * `group_by_value` read from that class's record. The field is qualified by class so callers can
	 * disambiguate same-named fields across the intersected classes.
	 */
	groupBy?: { classId: string; field: string } | null;
	/**
	 * Scope {@link query}. Encodings:
	 * - `null`/empty in a plain All-Files / "any of" view → **filename only**.
	 * - `null`/empty in an intersection ("all of", 2+ classes) → **All fields**: filename + every user
	 *   field of every intersected class.
	 * - `"<classId>::<field>"` → one specific field of one intersected class (mirrors the cross
	 *   group-by encoding).
	 */
	searchField?: string | null;
}): Promise<FileListResponse> {
	const { manifest, diskNames, healed } = await reconcileAndResync();
	await backfillDimensions(manifest, diskNames);

	const q = params?.query ? params.query.toLowerCase() : null;
	const classIds = params?.classIds ?? null;
	const matchAll = params?.matchAll ?? false;
	const unclassified = params?.unclassified ?? false;
	const groupBy = params?.groupBy ?? null;
	const searchField = params?.searchField || null;
	const crossMode = matchAll && !unclassified && !!classIds && classIds.length > 1;

	// Load the group-by class once so we can read each member's field value (best-effort).
	let groupByClassFile: ClassFile | null = null;
	if (groupBy) {
		try {
			groupByClassFile = await readClassFile(groupBy.classId);
		} catch {
			groupByClassFile = null;
		}
	}

	// Load the class file(s) needed to evaluate a field-scoped search (intersection only). A specific
	// `classId::field` loads that one class; an All-fields search in cross mode loads every intersected
	// class. Outside an intersection there is no single field context, so search stays filename-only.
	const [sfClassId, sfField] =
		searchField && searchField.includes('::') ? searchField.split('::') : [null, null];
	const searchClassFiles: { schema: SchemaDefinition; records: Record<string, unknown> }[] = [];
	if (q) {
		const idsToLoad = sfClassId ? [sfClassId] : crossMode ? (classIds ?? []) : [];
		for (const cid of idsToLoad) {
			const cf = await readClassFile(cid).catch(() => null);
			if (cf)
				searchClassFiles.push({
					schema: cf.schema,
					records: cf.records as Record<string, unknown>
				});
		}
	}

	/** Whether a blob matches the active text query given the (possibly field-scoped) search mode. */
	const matchesSearch = (id: string, fileName: string): boolean => {
		if (!q) return true;
		if (sfField) {
			const cf = searchClassFiles[0];
			if (!cf) return false;
			const rec = (cf.records[id] ?? {}) as Record<string, unknown>;
			return fieldSearchText(rec, cf.schema, sfField).includes(q);
		}
		if (searchClassFiles.length > 0) {
			// All-fields (intersection): filename or any user field of any intersected class.
			if (fileName.toLowerCase().includes(q)) return true;
			return searchClassFiles.some((cf) => {
				const rec = (cf.records[id] ?? {}) as Record<string, unknown>;
				return schemaUserFieldKeys(cf.schema).some((k) =>
					fieldSearchText(rec, cf.schema, k).includes(q)
				);
			});
		}
		return fileName.toLowerCase().includes(q); // filename only
	};

	const files: FileItem[] = [];
	for (const [id, entry] of Object.entries(manifest.files)) {
		if (!diskNames.has(entry.file_name)) continue; // hide blobs missing from disk in the grid
		if (unclassified) {
			if (entry.classes.length > 0) continue;
		} else if (classIds && classIds.length > 0) {
			const has = matchAll
				? classIds.every((c) => entry.classes.includes(c))
				: classIds.some((c) => entry.classes.includes(c));
			if (!has) continue;
		}
		if (!matchesSearch(id, entry.file_name)) continue;
		const item = fileItemFromEntry(id, manifest);
		if (groupByClassFile) {
			const rec = (groupByClassFile.records[id] ?? {}) as Record<string, unknown>;
			item.group_by_value = groupByValue(rec, groupByClassFile.schema, groupBy!.field);
		}
		files.push(item);
	}
	files.sort((a, b) => a.file_name.localeCompare(b.file_name));
	return { files, healed };
}

/**
 * The one-class catalog view: every member of a class as a {@link FileItem}, with the class's group-by
 * value, filename search, schema filters, and broken `file`-field annotations.
 */
export async function listClassMembers(
	id: string,
	params?: {
		query?: string | null;
		groupBy?: string | null;
		filters?: FilterClause[] | null;
		/**
		 * Scope {@link query} to one field key. `null`/empty = **All fields** (filename + every user
		 * field). A field key restricts the match to that class field only.
		 */
		searchField?: string | null;
	}
): Promise<FileListResponse> {
	const file = await readClassFile(id);
	const { manifest, diskNames, healed } = await reconcileAndResync();
	await backfillDimensions(manifest, diskNames);
	const available = availableFromManifest(manifest, diskNames);

	const groupBy = params?.groupBy ?? null;
	const filters = params?.filters ?? null;
	const q = params?.query ? params.query.toLowerCase() : null;
	const searchField = params?.searchField || null;

	const files: FileItem[] = [];
	for (const [fileId, rec] of Object.entries(file.records)) {
		const entry = manifest.files[fileId];
		const fileName = entry?.file_name ?? '';
		const recObj = rec as Record<string, unknown>;
		if (q) {
			const match = searchField
				? fieldSearchText(recObj, file.schema, searchField).includes(q)
				: fileName.toLowerCase().includes(q) ||
					schemaUserFieldKeys(file.schema).some((k) =>
						fieldSearchText(recObj, file.schema, k).includes(q)
					);
			if (!match) continue;
		}
		if (filters && filters.length > 0) {
			if (!filters.every((c) => evaluateClause(recObj, c, file.schema))) continue;
		}
		const item = fileItemFromEntry(fileId, manifest);
		if (groupBy) item.group_by_value = groupByValue(recObj, file.schema, groupBy);
		const miss = missingFileFields(recObj, file.schema, available);
		if (miss.length) item.missing_file_fields = miss;
		files.push(item);
	}
	files.sort((a, b) => a.file_name.localeCompare(b.file_name));
	return { files, healed };
}

// ---------------------------------------------------------------------------
// Per-blob operations (intrinsic; class-agnostic)
// ---------------------------------------------------------------------------

/** Resolve a manifest id to its filename, verifying the blob is on disk. Null if unknown/missing. */
export async function getFilenameForId(id: string): Promise<string | null> {
	const manifest = await readManifest();
	const name = manifest.files[id]?.file_name;
	if (!name) return null;
	const safe = assertSafeBasename(name);
	try {
		await fs.access(path.join(getGlobalFilesDir(), safe));
		return safe;
	} catch {
		return null;
	}
}

/** Ensure a blob exists in the manifest for a freshly-uploaded filename; returns its id. */
export async function registerBlob(fileName: string, size?: number): Promise<string> {
	return await mintFileId(assertSafeBasename(fileName), size);
}

/**
 * Delete a blob from disk, drop its manifest entry, and strip its member record from every class.
 */
export async function deleteFromDiskById(id: string): Promise<void> {
	const manifest = await readManifest();
	const entry = manifest.files[id];
	if (!entry) throw new Error('File not found');
	await fs.unlink(path.join(getGlobalFilesDir(), entry.file_name)).catch((err) => {
		const e = err as NodeJS.ErrnoException;
		if (e.code !== 'ENOENT') throw err;
	});
	await removeFileId(id);
	for (const cid of listClassIds()) {
		await withFileLock(classLockPath(cid), async () => {
			const file = await readClassFile(cid).catch(() => null);
			if (!file || !file.records[id]) return;
			const records = { ...file.records };
			delete records[id];
			await writeClassFile(cid, { ...file, records });
		});
	}
}

/** Delete many blobs from disk. */
export async function bulkDeleteFromDiskByIds(ids: string[]): Promise<void> {
	for (const id of ids) await deleteFromDiskById(id);
}

/**
 * Rename a blob: rename on disk, then update the single manifest entry (O(1); every `id` reference is
 * unaffected). Returns the new filename.
 */
export async function renameBlobById(id: string, newFilename: string): Promise<string> {
	const safe = assertSafeBasename(newFilename);
	const manifest = await readManifest();
	const entry = manifest.files[id];
	if (!entry) throw new Error('File not found');
	if (safe === entry.file_name) return safe;

	const filesDir = getGlobalFilesDir();
	const oldPath = path.join(filesDir, entry.file_name);
	const newPath = path.join(filesDir, safe);
	if (fssync.existsSync(newPath)) {
		const err = new Error('Target filename already exists');
		(err as { status?: number }).status = 409;
		throw err;
	}
	await fs.rename(oldPath, newPath);
	try {
		await manifestRenameFileId(id, safe);
	} catch (err) {
		await fs.rename(newPath, oldPath).catch(() => {});
		throw err;
	}
	return safe;
}

/** One dangling reference to a missing blob (for the global missing-files warning). */
export interface MissingFileRef {
	file_id: string;
	file_name: string;
	context: string;
	label: string;
	field: string | null;
}

/**
 * Find every dangling reference to a blob absent from disk: class **memberships** whose blob vanished,
 * and `file`-type field values (in classes and `json` types, incl. globals) pointing at an unavailable
 * id. The filename shown is the manifest's last-known name. Grouped per missing blob by the caller.
 */
export async function listMissingFileReferences(): Promise<MissingFileRef[]> {
	const { manifest, available } = await getAvailableFileIds();
	const out: MissingFileRef[] = [];
	const nameFor = (id: string) => manifest.files[id]?.file_name ?? '';

	const recordLabel = (
		rec: Record<string, unknown>,
		schema: SchemaDefinition,
		fallback: string
	) => {
		for (const [k, def] of Object.entries(schema)) {
			if (def?.type === 'string' && typeof rec[k] === 'string' && (rec[k] as string).trim())
				return rec[k] as string;
		}
		return fallback;
	};

	const scan = (
		context: string,
		schema: SchemaDefinition,
		records: Record<string, Record<string, unknown>>,
		opts: { membershipKeyedByFileId: boolean }
	) => {
		for (const [recId, rec] of Object.entries(records)) {
			const label = recordLabel(rec, schema, opts.membershipKeyedByFileId ? nameFor(recId) : recId);
			if (opts.membershipKeyedByFileId && !available.has(recId)) {
				out.push({ file_id: recId, file_name: nameFor(recId), context, label, field: null });
			}
			for (const [key, def] of Object.entries(schema)) {
				if (def?.type !== 'file') continue;
				const v = rec[key];
				if (typeof v !== 'string' || v === '' || available.has(v)) continue;
				out.push({ file_id: v, file_name: nameFor(v), context, label, field: key });
			}
		}
	};

	for (const cid of listClassIds()) {
		try {
			const file = await readClassFile(cid);
			scan(file.config.displayName || cid, file.schema, file.records as never, {
				membershipKeyedByFileId: true
			});
		} catch {
			/* skip */
		}
	}

	// json-kind types (incl. globals): only `file`-field references can dangle (rows aren't blobs).
	const { listMediaTypeIds, getMediaTypePaths } = await import('./paths.js');
	const { readMediaTypeSettingsFileSync } = await import('./settingsFile.js');
	for (const tId of listMediaTypeIds()) {
		try {
			const mp = getMediaTypePaths(tId);
			const settings = readMediaTypeSettingsFileSync(mp.baseDir);
			if (!settings) continue;
			const raw = JSON.parse(fssync.readFileSync(mp.dataPath, 'utf-8')) as {
				records?: Record<string, unknown>[];
			};
			const records: Record<string, Record<string, unknown>> = {};
			for (const r of raw.records ?? []) {
				const id = (r as { id?: string }).id;
				if (id) records[id] = r as Record<string, unknown>;
			}
			scan(settings.displayName || tId, settings.schema ?? {}, records, {
				membershipKeyedByFileId: false
			});
		} catch {
			/* skip */
		}
	}

	return out;
}

/**
 * Which classes currently have a member record for a blob (used for delete confirmations and the
 * missing-files warning).
 */
export function listClassesReferencingFileId(
	fileId: string
): { id: string; displayName: string }[] {
	const out: { id: string; displayName: string }[] = [];
	for (const cid of listClassIds()) {
		try {
			const raw = JSON.parse(fssync.readFileSync(getClassFilePath(cid), 'utf-8')) as {
				config?: { displayName?: string };
				records?: Record<string, unknown>;
			};
			if (raw.records && fileId in raw.records) {
				out.push({ id: cid, displayName: raw.config?.displayName || cid });
			}
		} catch {
			/* skip */
		}
	}
	return out;
}
