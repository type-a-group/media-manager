import { getMediaTypePaths } from './paths.js';
import { readMediaTypeSettingsFileSync } from './settingsFile.js';
import { readJsonFile } from './json.js';
import { JsonDataFileSchema, type SchemaDefinition } from '$lib/core/types.js';
import { projectRecordRow, recordListTitle } from '$lib/core/recordDisplay.js';

/**
 * Cross-type resolution data for `record`-field references, built once per list/get request.
 *
 * A `file` field resolves against the single global blob manifest; a `record` field resolves against
 * *another* json record type's data file — so resolution is cross-type and async and cannot live in the
 * pure {@link stringifyFieldValue}. This module reads each referenced target type once and exposes:
 * - `available`: typeId → set of currently-existing record ids (for missing-ref detection), and
 * - `titles`: typeId → (id → display title) so a referenced record renders by its title, not a raw id.
 *
 * Concerns / future improvements:
 * - Reads every record of each target type. Targets are small JSON files and each type is read once per
 *   request (deduped by typeId), so there is no per-row N+1. Revisit if record types grow very large.
 */
export interface RecordRefResolver {
	available: Map<string, Set<string>>;
	titles: Map<string, Map<string, string>>;
}

/**
 * The title field a target type uses for display. Mirrors `jsonRepo.listRecords`'s precedence:
 * persisted `displayField` → `name` if present → first string field → first field → none.
 */
function effectiveTitleField(schema: SchemaDefinition, displayField?: string): string | null {
	if (displayField) return displayField;
	const keys = Object.keys(schema);
	if (keys.includes('name')) return 'name';
	const firstString = keys.find((k) => schema[k]?.type === 'string');
	return firstString ?? keys[0] ?? null;
}

/** Read one target type's records into an id set + an id→title map; null when the type is unavailable. */
async function loadTypeIndex(
	typeId: string
): Promise<{ ids: Set<string>; titles: Map<string, string> } | null> {
	let paths;
	try {
		paths = getMediaTypePaths(typeId);
	} catch {
		return null; // target type no longer exists
	}
	if (paths.kind !== 'json') return null;
	const settings = readMediaTypeSettingsFileSync(paths.baseDir);
	if (!settings) return null;
	const schema = settings.schema ?? {};
	const titleField = effectiveTitleField(schema, settings.displayField);

	let records: { id: string; [k: string]: unknown }[] = [];
	try {
		records = JsonDataFileSchema.parse(await readJsonFile(paths.dataPath)).records;
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code !== 'ENOENT') throw err;
	}

	const ids = new Set<string>();
	const titles = new Map<string, string>();
	for (const rec of records) {
		ids.add(rec.id);
		const proj = projectRecordRow(schema, rec, { titleField });
		titles.set(rec.id, recordListTitle({ id: rec.id, ...proj }));
	}
	return { ids, titles };
}

/**
 * Build the {@link RecordRefResolver} for a schema: load every distinct target type referenced by a
 * `record` field. A target type that no longer exists resolves to empty sets (all its refs read as
 * missing). Returns empty maps when the schema has no `record` fields (callers skip the work).
 */
export async function resolveRecordRefs(schema: SchemaDefinition): Promise<RecordRefResolver> {
	const targets = new Set<string>();
	for (const def of Object.values(schema)) {
		if (def?.type === 'record' && (def as { recordType?: string }).recordType) {
			targets.add((def as { recordType: string }).recordType);
		}
	}
	const available = new Map<string, Set<string>>();
	const titles = new Map<string, Map<string, string>>();
	for (const typeId of targets) {
		const idx = await loadTypeIndex(typeId);
		available.set(typeId, idx?.ids ?? new Set());
		titles.set(typeId, idx?.titles ?? new Map());
	}
	return { available, titles };
}

/** Whether the schema declares any `record` field (so callers can skip resolution entirely). */
export function schemaHasRecordField(schema: SchemaDefinition): boolean {
	return Object.values(schema).some((d) => d?.type === 'record');
}

/** Normalize a `record`-field value (single id or id[]) to an id array, dropping empties. */
function refIds(val: unknown): string[] {
	if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string' && v !== '');
	return typeof val === 'string' && val !== '' ? [val] : [];
}

/**
 * The `record`-type field keys on `record` whose referenced id(s) no longer resolve in the target type.
 * A field with a non-empty value but no configured `recordType`, or any unresolved id, counts as broken
 * (parity with `missingFileFields`). Empty values are never broken.
 */
export function missingRecordFields(
	record: Record<string, unknown>,
	schema: SchemaDefinition,
	resolver: RecordRefResolver
): string[] {
	const out: string[] = [];
	for (const [key, def] of Object.entries(schema)) {
		if (def?.type !== 'record') continue;
		const ids = refIds(record[key]);
		if (ids.length === 0) continue;
		const recordType = (def as { recordType?: string }).recordType;
		const avail = recordType ? resolver.available.get(recordType) : undefined;
		if (!avail || ids.some((id) => !avail.has(id))) out.push(key);
	}
	return out;
}

/**
 * Map of `record`-field key → a short hint (the broken id prefixes) for each dangling reference, or
 * undefined when nothing is broken. Mirrors `missingFilesMap`; since the target record is gone there is
 * no title to show, so the hint is the short id(s).
 */
export function missingRecordsMap(
	record: Record<string, unknown>,
	schema: SchemaDefinition,
	resolver: RecordRefResolver
): Record<string, string> | undefined {
	const keys = missingRecordFields(record, schema, resolver);
	if (keys.length === 0) return undefined;
	const out: Record<string, string> = {};
	for (const key of keys) {
		const def = schema[key] as { recordType?: string };
		const avail = def.recordType ? resolver.available.get(def.recordType) : undefined;
		const missing = refIds(record[key]).filter((id) => !avail?.has(id));
		out[key] = missing.map((id) => id.slice(0, 8)).join(', ');
	}
	return out;
}

/**
 * Build the `resolveRef` callback threaded into {@link stringifyFieldValue} / {@link buildFieldValues} /
 * {@link projectRecordRow} / {@link fieldSortValue}: given a `record` field key + raw value, return the
 * referenced record title(s) (comma-joined for multiselect). Unresolved ids fall back to a short id.
 * Returns undefined for non-record fields so the caller's normal stringify path runs.
 */
export function recordRefRenderer(
	schema: SchemaDefinition,
	resolver: RecordRefResolver
): (key: string, val: unknown) => string | undefined {
	return (key, val) => {
		const def = schema[key];
		if (def?.type !== 'record') return undefined;
		const recordType = (def as { recordType?: string }).recordType;
		const titles = recordType ? resolver.titles.get(recordType) : undefined;
		const ids = refIds(val);
		if (ids.length === 0) return undefined;
		return ids.map((id) => titles?.get(id) || id.slice(0, 8)).join(', ');
	};
}
