import path from 'node:path';
import * as fs from 'node:fs/promises';
import { withFileLock } from './lock.js';
import {
	GLOBALS_TYPE_ID,
	getMediaTypeBaseDir,
	listMediaTypeIds,
	listClassIds,
	getMediaTypePaths
} from './paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from './settingsFile.js';
import {
	getClassSchema,
	getRecord,
	updateRecord,
	updateSchemaField,
	readClassFile
} from './classRepo.js';
import { createJsonRepoForType } from './jsonRepo.js';
import type { FieldDefinition, JsonRecord, SchemaDefinition } from '$lib/core/types.js';

/**
 * Two-way relation links between a Files **class** and a Records **json type**.
 *
 * A linked pair is exactly one shape (v1): a class `C`'s `record` field `R` (with `recordType = T`)
 * paired with type `T`'s `file` field `F` (with `classId = C`). The link is *declared* on the record
 * side — `R.linkedField = F` is the single source of truth for the pairing — and the file side's
 * `F.linkedField = R` is **server-maintained** (mirrored here). Both pointers reference each other so
 * either side can render/propagate without consulting the other.
 *
 * This module owns the **schema-level** mirroring (keeping `F.linkedField` in sync with the class's
 * record fields). The **data-level** propagation (mirroring actual id references when a value changes)
 * is layered on top in the same module (see the propagation section).
 *
 * Concerns / future improvements:
 * - v1 is one link shape (class record ⇄ type file). The `(side, partner)` shape is kept explicit so
 *   class↔class / record↔record links could be added later without a rewrite.
 * - `reconcileClassRecordLinks` scans every json type so it can clear stale back-links left by a
 *   removed/retargeted record-field link. Schema writes are rare and types are few, so the scan is cheap.
 */

/** A `file` field def carries `classId` (scope) + the server-maintained `linkedField` back-pointer. */
type FileFieldDef = FieldDefinition & { classId?: string; linkedField?: string };
/** A `record` field def carries `recordType` (target) + `linkedField` (the declared counterpart key). */
type RecordFieldDef = FieldDefinition & { recordType?: string; linkedField?: string };

/**
 * Validate that a class `record` field's declared link counterpart is a real, correctly-scoped file
 * field on the target type. Used by the schema endpoint before accepting a link so a half-link
 * (record side set, no valid file side) can never be persisted.
 *
 * @param classId - The class hosting the record field (the link's `C`).
 * @param recordType - The record field's target json type (`T`).
 * @param linkedFileField - The chosen counterpart file-field key on `T` (`F`).
 * @returns true when `T.F` exists, is a `file` field, and is scoped to this class (`classId === C`).
 */
export function isValidLinkCounterpart(
	classId: string,
	recordType: string | undefined,
	linkedFileField: string
): boolean {
	if (!recordType || recordType === GLOBALS_TYPE_ID || !linkedFileField) return false;
	const settings = readMediaTypeSettingsFileSync(getMediaTypeBaseDir(recordType));
	const def = settings?.schema?.[linkedFileField] as FileFieldDef | undefined;
	return !!def && def.type === 'file' && def.classId === classId;
}

/**
 * Mirror a class's record-field link declarations onto the counterpart file fields, and clear any
 * stale back-links. Call after **any** mutation to a class's schema (add/update/delete field).
 *
 * For each json type it sets `F.linkedField = R` exactly when some record field `R` on the class
 * declares `linkedField = F` + `recordType = <that type>`, and clears `F.linkedField` otherwise (for
 * every `file` field scoped to this class). Runs after the class write has released its lock, taking
 * each type's settings lock independently — no nested class+type locking here.
 *
 * @param classId - The class whose record-field links to mirror.
 */
export async function reconcileClassRecordLinks(classId: string): Promise<void> {
	const schema = await getClassSchema(classId);

	// Desired back-links grouped by target type: typeId -> (fileFieldKey -> recordFieldKey).
	const desired = new Map<string, Map<string, string>>();
	for (const [recordKey, raw] of Object.entries(schema)) {
		const def = raw as RecordFieldDef;
		if (def.type === 'record' && def.linkedField && def.recordType) {
			const m = desired.get(def.recordType) ?? new Map<string, string>();
			m.set(def.linkedField, recordKey);
			desired.set(def.recordType, m);
		}
	}

	// Scan every json type (not just current targets) so a removed/retargeted link's stale back-link
	// is cleared too.
	for (const typeId of listMediaTypeIds()) {
		if (typeId === GLOBALS_TYPE_ID) continue;
		await reconcileTypeBackLinks(typeId, classId, desired.get(typeId) ?? new Map());
	}
}

/**
 * Backfill existing one-sided references when a link is (re)declared: for every member whose linked
 * `record` field already points at some record, ensure that record's counterpart `file` field lists
 * the member. Idempotent (skips edges that already exist), so it's safe to run after any class schema
 * write. Mirrors class → type, which covers the real flow (you tag files with a record, then add and
 * link the inverse file field); a fresh counterpart file field has no pre-existing data to mirror back.
 */
export async function backfillClassLinks(classId: string): Promise<void> {
	const schema = await getClassSchema(classId);
	const links = linkedRecordFields(schema);
	if (links.length === 0) return;
	const classFile = await readClassFile(classId);
	for (const l of links) {
		const fDef = targetFileFieldDef(l.recordType, l.fileField);
		if (!fDef || fDef.type !== 'file') continue;
		const link = {
			typeId: l.recordType,
			fileField: l.fileField,
			fMulti: isMulti(fDef),
			classId,
			recordField: l.recordField
		};
		for (const [fileId, rec] of Object.entries(classFile.records)) {
			for (const recordId of asIdArray((rec as Record<string, unknown>)[l.recordField]))
				await addRecordFileRef(link, recordId, fileId);
		}
	}
}

/** Read a json type's records as raw objects (id + field values), bypassing projection/migration. */
async function readTypeRecordsRaw(typeId: string): Promise<Record<string, unknown>[]> {
	try {
		const { dataPath } = getMediaTypePaths(typeId);
		const raw = await fs.readFile(dataPath, 'utf-8');
		const parsed = JSON.parse(raw) as { records?: unknown };
		return Array.isArray(parsed.records) ? (parsed.records as Record<string, unknown>[]) : [];
	} catch {
		return [];
	}
}

/**
 * Preview the data mismatch a proposed link would have, **without mutating anything**. Compares the
 * existing edges asserted by the class `record` field vs the type `file` field so the schema editor can
 * decide whether to prompt the user to reconcile. Returns the count of edges present on only one side.
 */
export async function previewLinkData(
	classId: string,
	recordField: string,
	recordType: string,
	fileField: string
): Promise<{ classOnly: number; typeOnly: number }> {
	const classFile = await readClassFile(classId).catch(() => null);
	if (!classFile) return { classOnly: 0, typeOnly: 0 };
	const classEdges = new Set<string>();
	for (const [blobId, rec] of Object.entries(classFile.records))
		for (const r of asIdArray((rec as Record<string, unknown>)[recordField]))
			classEdges.add(`${blobId}|${r}`);
	const typeEdges = new Set<string>();
	for (const r of await readTypeRecordsRaw(recordType))
		for (const b of asIdArray(r[fileField])) typeEdges.add(`${b}|${r.id}`);
	let classOnly = 0;
	let typeOnly = 0;
	for (const e of classEdges) if (!typeEdges.has(e)) classOnly++;
	for (const e of typeEdges) if (!classEdges.has(e)) typeOnly++;
	return { classOnly, typeOnly };
}

/** Set equality over two id arrays (order-insensitive). */
function sameIds(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const s = new Set(a);
	return b.every((x) => s.has(x));
}

/**
 * Make a newly-declared link's data consistent by treating **one side as authoritative** and rebuilding
 * the other to match. Used at link-creation when the two sides already hold mismatched data (the schema
 * editor prompts the user to pick the winner).
 *
 * - `'class'` — the class `record` field wins: each target record's `file` field is rebuilt to exactly
 *   the set of members pointing at it (type-side-only refs are dropped).
 * - `'type'` — the type `file` field wins: each member's `record` field is rebuilt from the records that
 *   list it (cardinality-respecting — a single record field keeps the first), then the file fields are
 *   re-derived from that so a single-side conflict can't leave the two stores disagreeing.
 */
export async function reconcileLinkData(
	classId: string,
	recordField: string,
	strategy: 'class' | 'type'
): Promise<void> {
	const schema = await getClassSchema(classId).catch(() => null);
	const def = schema?.[recordField] as RecordFieldDef | undefined;
	if (!def || def.type !== 'record' || !def.linkedField || !def.recordType) return;
	const { recordType, linkedField: fileField } = def;
	const rMulti = isMulti(def);
	const fDef = targetFileFieldDef(recordType, fileField);
	if (!fDef || fDef.type !== 'file') return;
	const fMulti = isMulti(fDef);
	const repo = createJsonRepoForType(recordType);

	if (strategy === 'type') {
		// Type wins: rebuild each member's record field from the records that list it.
		const blobToRecords = new Map<string, string[]>();
		for (const r of await readTypeRecordsRaw(recordType))
			for (const b of asIdArray(r[fileField])) {
				const arr = blobToRecords.get(b) ?? [];
				arr.push(String(r.id));
				blobToRecords.set(b, arr);
			}
		const classFile = await readClassFile(classId);
		for (const blobId of Object.keys(classFile.records)) {
			const all = blobToRecords.get(blobId) ?? [];
			const want = rMulti ? all : all.slice(0, 1); // single keeps the first claimant
			const cur = asIdArray((classFile.records[blobId] as Record<string, unknown>)[recordField]);
			if (!sameIds(want, cur))
				await updateRecord(classId, blobId, { [recordField]: rMulti ? want : (want[0] ?? '') });
		}
		// Fall through to re-derive the file side from the (now-authoritative) record field so a
		// single-cardinality conflict drops the loser from both stores.
	}

	// Class wins (and the tail of `type`): rebuild each target record's file field from the record field.
	const recordToBlobs = new Map<string, string[]>();
	const classFile = await readClassFile(classId);
	for (const [blobId, rec] of Object.entries(classFile.records))
		for (const r of asIdArray((rec as Record<string, unknown>)[recordField])) {
			const arr = recordToBlobs.get(r) ?? [];
			arr.push(blobId);
			recordToBlobs.set(r, arr);
		}
	for (const r of await readTypeRecordsRaw(recordType)) {
		const want = recordToBlobs.get(String(r.id)) ?? [];
		const cur = asIdArray(r[fileField]);
		if (!sameIds(want, cur))
			await repo.updatePropertiesById(String(r.id), {
				[fileField]: fMulti ? want : (want[0] ?? '')
			});
	}
}

/**
 * Reconcile one type's `file` fields scoped to `classId` against the desired back-links.
 * Sets/clears `linkedField` on each such field and writes the type's schema only when changed.
 *
 * @param typeId - The json type to reconcile.
 * @param classId - The class the back-links point to.
 * @param wants - fileFieldKey -> recordFieldKey for every link the class currently declares to this type.
 */
async function reconcileTypeBackLinks(
	typeId: string,
	classId: string,
	wants: Map<string, string>
): Promise<void> {
	const baseDir = getMediaTypeBaseDir(typeId);
	const settingsPath = path.join(baseDir, 'settings.json');
	await withFileLock(`${settingsPath}.lock`, async () => {
		const settings = readMediaTypeSettingsFileSync(baseDir);
		if (!settings?.schema) return;
		const schema: SchemaDefinition = { ...settings.schema };
		let dirty = false;
		for (const [fileKey, raw] of Object.entries(schema)) {
			const def = raw as FileFieldDef;
			if (def.type !== 'file' || def.classId !== classId) continue;
			const wantedRecordKey = wants.get(fileKey);
			if (wantedRecordKey) {
				if (def.linkedField !== wantedRecordKey) {
					schema[fileKey] = { ...def, linkedField: wantedRecordKey };
					dirty = true;
				}
			} else if (def.linkedField) {
				const next = { ...def };
				delete (next as FileFieldDef).linkedField;
				schema[fileKey] = next;
				dirty = true;
			}
		}
		if (dirty) await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });
	});
}

/**
 * Resolve a linked pair from the **file** side: given a type's file field that carries a
 * `linkedField` + `classId`, return the class + record-field it links back to. Used by the file-side
 * "Unlink" affordance (which clears the declaration on the record side). Returns null when unlinked.
 */
export function linkPartnerOfFileField(
	def: FieldDefinition
): { classId: string; recordField: string } | null {
	const f = def as FileFieldDef;
	if (f.type === 'file' && f.classId && f.linkedField)
		return { classId: f.classId, recordField: f.linkedField };
	return null;
}

/** Guard so callers can confirm a type id resolves to a real json type before linking against it. */
export function typeExists(typeId: string): boolean {
	try {
		getMediaTypePaths(typeId);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Data-level propagation — keep the two stores' actual id references in sync.
// ---------------------------------------------------------------------------
//
// Design notes:
// - **No nested locks.** Each write (originating + every reciprocal partner write) takes its own
//   file lock and releases it before the next. We never hold two locks at once, so two concurrent
//   linked writes cannot deadlock — this is why the plan's "canonical lock order" isn't needed.
//   The cost is a brief window where one side is updated and the other isn't; reads render each side
//   from its own data, and `reconcileLinkData` heals any residual skew.
// - **No re-entry (loop guard).** Reciprocal writes go through the bare repo mutators
//   (`updateRecord` / `updatePropertiesById`), never the `*Linked` wrappers — so a propagated write
//   never re-triggers propagation. The originating diff already represents both halves of the change.
// - **Cardinality move.** Adding a ref into a *single*-cardinality partner field that is already
//   occupied overwrites it and removes the displaced edge from the third entity (a pure removal —
//   removals never displace, so recursion is depth-1 bounded and always terminates).

/** Normalize a file/record-field value (single id, id[], or empty) to a clean id array. */
function asIdArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
	if (typeof v === 'string' && v !== '') return [v];
	return [];
}

function isMulti(def: FieldDefinition | undefined): boolean {
	return (def as { multiselect?: boolean } | undefined)?.multiselect === true;
}

/** The linked `record` fields on a class schema (declaration side). */
function linkedRecordFields(
	schema: SchemaDefinition
): { recordField: string; recordType: string; fileField: string; rMulti: boolean }[] {
	const out: { recordField: string; recordType: string; fileField: string; rMulti: boolean }[] = [];
	for (const [key, raw] of Object.entries(schema)) {
		const def = raw as RecordFieldDef;
		if (def.type === 'record' && def.linkedField && def.recordType)
			out.push({
				recordField: key,
				recordType: def.recordType,
				fileField: def.linkedField,
				rMulti: isMulti(def)
			});
	}
	return out;
}

/** The linked `file` fields on a json type schema (the mirrored side). */
function linkedFileFields(
	schema: SchemaDefinition
): { fileField: string; classId: string; recordField: string; fMulti: boolean }[] {
	const out: { fileField: string; classId: string; recordField: string; fMulti: boolean }[] = [];
	for (const [key, raw] of Object.entries(schema)) {
		const def = raw as FileFieldDef;
		if (def.type === 'file' && def.linkedField && def.classId)
			out.push({
				fileField: key,
				classId: def.classId,
				recordField: def.linkedField,
				fMulti: isMulti(def)
			});
	}
	return out;
}

/** The counterpart file-field def on a target type, or undefined. */
function targetFileFieldDef(typeId: string, fileField: string): FieldDefinition | undefined {
	return readMediaTypeSettingsFileSync(getMediaTypeBaseDir(typeId))?.schema?.[fileField];
}

// ---- raw edge mutators (no propagation) -----------------------------------

/** Raw-remove `fileId` from a json record's file field (cardinality inferred from stored shape). */
async function removeRecordFileRef(
	typeId: string,
	fileField: string,
	recordId: string,
	fileId: string
): Promise<void> {
	const repo = createJsonRepoForType(typeId);
	const rec = await repo.getRecordById(recordId);
	if (!rec) return;
	const raw = (rec as Record<string, unknown>)[fileField];
	if (asIdArray(raw).includes(fileId)) {
		const next = Array.isArray(raw) ? asIdArray(raw).filter((x) => x !== fileId) : '';
		await repo.updatePropertiesById(recordId, { [fileField]: next });
	}
}

/** Raw-remove `recordId` from a class member's record field (cardinality inferred from stored shape). */
async function removeBlobRecordRef(
	classId: string,
	recordField: string,
	fileId: string,
	recordId: string
): Promise<void> {
	const rec = await getRecord(classId, fileId);
	if (!rec) return;
	const raw = (rec as Record<string, unknown>)[recordField];
	if (asIdArray(raw).includes(recordId)) {
		const next = Array.isArray(raw) ? asIdArray(raw).filter((x) => x !== recordId) : '';
		await updateRecord(classId, fileId, { [recordField]: next });
	}
}

/** Raw-add `fileId` to a json record's file field; on a single field, move (displace the old blob). */
async function addRecordFileRef(
	link: {
		typeId: string;
		fileField: string;
		fMulti: boolean;
		classId: string;
		recordField: string;
	},
	recordId: string,
	fileId: string
): Promise<void> {
	const repo = createJsonRepoForType(link.typeId);
	const rec = await repo.getRecordById(recordId);
	if (!rec) return;
	const cur = asIdArray((rec as Record<string, unknown>)[link.fileField]);
	if (link.fMulti) {
		if (!cur.includes(fileId))
			await repo.updatePropertiesById(recordId, { [link.fileField]: [...cur, fileId] });
	} else {
		const displaced = cur[0];
		if (displaced === fileId) return;
		await repo.updatePropertiesById(recordId, { [link.fileField]: fileId });
		// The displaced blob must drop this record from its (now-stolen) record field.
		if (displaced) await removeBlobRecordRef(link.classId, link.recordField, displaced, recordId);
	}
}

/** Raw-add `recordId` to a class member's record field; on a single field, move (displace old record). */
async function addBlobRecordRef(
	link: {
		classId: string;
		recordField: string;
		rMulti: boolean;
		recordType: string;
		fileField: string;
	},
	fileId: string,
	recordId: string
): Promise<void> {
	const rec = await getRecord(link.classId, fileId);
	if (!rec) return;
	const cur = asIdArray((rec as Record<string, unknown>)[link.recordField]);
	if (link.rMulti) {
		if (!cur.includes(recordId))
			await updateRecord(link.classId, fileId, { [link.recordField]: [...cur, recordId] });
	} else {
		const displaced = cur[0];
		if (displaced === recordId) return;
		await updateRecord(link.classId, fileId, { [link.recordField]: recordId });
		// The displaced record must drop this blob from its (now-stolen) file field.
		if (displaced) await removeRecordFileRef(link.recordType, link.fileField, displaced, fileId);
	}
}

// ---- public wrappers (used by the record write endpoints) -----------------

/**
 * Update a class member's metadata, then propagate any changes to linked `record` fields onto the
 * counterpart `file` fields of the target type(s). Drop-in for `classRepo.updateRecord` on the write
 * path; falls through to the bare write when no linked field is touched.
 */
export async function updateClassRecordLinked(
	classId: string,
	fileId: string,
	patch: Record<string, unknown>
): Promise<JsonRecord> {
	const schema = await getClassSchema(classId);
	const touched = linkedRecordFields(schema).filter((l) => l.recordField in patch);
	if (touched.length === 0) return updateRecord(classId, fileId, patch);

	const before = await getRecord(classId, fileId);
	const updated = await updateRecord(classId, fileId, patch);
	for (const l of touched) {
		const beforeIds = asIdArray((before as Record<string, unknown> | null)?.[l.recordField]);
		const afterIds = asIdArray((updated as Record<string, unknown>)[l.recordField]);
		const added = afterIds.filter((x) => !beforeIds.includes(x));
		const removed = beforeIds.filter((x) => !afterIds.includes(x));
		const fMulti = isMulti(targetFileFieldDef(l.recordType, l.fileField));
		const link = {
			typeId: l.recordType,
			fileField: l.fileField,
			fMulti,
			classId,
			recordField: l.recordField
		};
		for (const r of removed) await removeRecordFileRef(l.recordType, l.fileField, r, fileId);
		for (const r of added) await addRecordFileRef(link, r, fileId);
	}
	return updated;
}

/**
 * Update a json record, then propagate any changes to linked `file` fields onto the counterpart
 * `record` fields of the partner class's members. Drop-in for `jsonRepo.updatePropertiesById` on the
 * write path; falls through to the bare write when no linked field is touched.
 */
export async function updateTypeRecordLinked(
	typeId: string,
	recordId: string,
	patch: Record<string, unknown>
): Promise<JsonRecord> {
	const repo = createJsonRepoForType(typeId);
	const schema = await repo.getSchema();
	const touched = linkedFileFields(schema).filter((l) => l.fileField in patch);
	if (touched.length === 0) return repo.updatePropertiesById(recordId, patch);

	const before = await repo.getRecordById(recordId);
	const updated = await repo.updatePropertiesById(recordId, patch);
	for (const l of touched) {
		const beforeIds = asIdArray((before as Record<string, unknown> | null)?.[l.fileField]);
		const afterIds = asIdArray((updated as Record<string, unknown>)[l.fileField]);
		const added = afterIds.filter((x) => !beforeIds.includes(x));
		const removed = beforeIds.filter((x) => !afterIds.includes(x));
		const classSchema = await getClassSchema(l.classId).catch(() => ({}) as SchemaDefinition);
		const rMulti = isMulti(classSchema[l.recordField]);
		const link = {
			classId: l.classId,
			recordField: l.recordField,
			rMulti,
			recordType: typeId,
			fileField: l.fileField
		};
		for (const b of removed) await removeBlobRecordRef(l.classId, l.recordField, b, recordId);
		for (const b of added) await addBlobRecordRef(link, b, recordId);
	}
	return updated;
}

// ---------------------------------------------------------------------------
// Cascades — keep links from dangling when an entity/field is removed.
// ---------------------------------------------------------------------------
//
// Each runs *before* the destructive op (so the about-to-vanish refs are still readable) except the
// schema purges, which only read sibling schemas and so can run after. All use the same lock-free,
// loop-guarded raw mutators as the propagation engine.

/**
 * A blob is leaving a class (membership removed): drop it from every record that the class's linked
 * record fields point at. Call **before** `removeMembers` so the blob's record-field values are still
 * readable. No-op when the class has no linked record fields or the blob isn't a member.
 */
export async function unlinkBlobFromClass(classId: string, fileId: string): Promise<void> {
	const schema = await getClassSchema(classId).catch(() => null);
	if (!schema) return;
	const links = linkedRecordFields(schema);
	if (links.length === 0) return;
	const rec = await getRecord(classId, fileId);
	if (!rec) return;
	for (const l of links) {
		for (const recordId of asIdArray((rec as Record<string, unknown>)[l.recordField]))
			await removeRecordFileRef(l.recordType, l.fileField, recordId, fileId);
	}
}

/**
 * A blob is being deleted from disk (removed from every class): unlink it from each class it belongs
 * to. Call **before** `deleteFromDiskById`.
 */
export async function unlinkBlobEverywhere(fileId: string): Promise<void> {
	for (const classId of listClassIds()) await unlinkBlobFromClass(classId, fileId);
}

/**
 * A json record is being deleted: drop it from every blob that the type's linked file fields point at.
 * Call **before** `deleteRecord` so the record's file-field values are still readable.
 */
export async function unlinkRecordEverywhere(typeId: string, recordId: string): Promise<void> {
	const repo = createJsonRepoForType(typeId);
	const schema = await repo.getSchema().catch(() => ({}) as SchemaDefinition);
	const links = linkedFileFields(schema);
	if (links.length === 0) return;
	const rec = await repo.getRecordById(recordId);
	if (!rec) return;
	for (const l of links) {
		for (const fileId of asIdArray((rec as Record<string, unknown>)[l.fileField]))
			await removeBlobRecordRef(l.classId, l.recordField, fileId, recordId);
	}
}

/**
 * A type's linked `file` field was deleted: clear the link declaration on its partner class record
 * field so it isn't left pointing at a gone field. Call **after** the field delete.
 */
export async function onFileFieldDeleted(deletedDef: FieldDefinition): Promise<void> {
	const partner = linkPartnerOfFileField(deletedDef);
	if (!partner) return;
	await updateSchemaField(partner.classId, partner.recordField, {
		type: 'record',
		linkedField: ''
	}).catch(() => {});
	await reconcileClassRecordLinks(partner.classId).catch(() => {});
}

/**
 * A class is being deleted: strip `classId` + `linkedField` from every type `file` field scoped to it
 * (degrades the field to an unlinked "Any file" field rather than leaving it pointing at a gone class).
 */
export async function purgeClassLinks(classId: string): Promise<void> {
	for (const typeId of listMediaTypeIds()) {
		if (typeId === GLOBALS_TYPE_ID) continue;
		const baseDir = getMediaTypeBaseDir(typeId);
		const settingsPath = path.join(baseDir, 'settings.json');
		await withFileLock(`${settingsPath}.lock`, async () => {
			const settings = readMediaTypeSettingsFileSync(baseDir);
			if (!settings?.schema) return;
			const schema: SchemaDefinition = { ...settings.schema };
			let dirty = false;
			for (const [key, raw] of Object.entries(schema)) {
				const def = raw as FileFieldDef;
				if (def.type === 'file' && def.classId === classId) {
					const next = { ...def };
					delete (next as FileFieldDef).classId;
					delete (next as FileFieldDef).linkedField;
					schema[key] = next;
					dirty = true;
				}
			}
			if (dirty) await writeMediaTypeSettingsFile(baseDir, { kind: 'json', schema });
		});
	}
}

/**
 * A type is being deleted: clear `linkedField` on every class `record` field targeting it (the
 * dangling `recordType` itself degrades gracefully — the field just reads as unresolved). Call from
 * the type-delete path.
 */
export async function purgeTypeLinks(typeId: string): Promise<void> {
	for (const classId of listClassIds()) {
		const schema = await getClassSchema(classId).catch(() => null);
		if (!schema) continue;
		for (const [key, raw] of Object.entries(schema)) {
			const def = raw as RecordFieldDef;
			if (def.type === 'record' && def.recordType === typeId && def.linkedField)
				await updateSchemaField(classId, key, { type: 'record', linkedField: '' }).catch(() => {});
		}
	}
}
