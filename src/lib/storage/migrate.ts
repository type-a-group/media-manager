import { z } from 'zod';
import {
	SchemaFileSchema,
	type SchemaFile,
	type SchemaDefinition,
	ImageDataFileSchema,
	type ImageDataFile,
	type ImageRecord,
	ImageRecordSchema
} from '$lib/core/types.js';

/**
 * Legacy-to-canonical field key mappings.
 *
 * Use case:
 * - Allows us to migrate old keys like `Description` into `description`.
 *
 * Concerns / future improvements:
 * - If you want “display labels” separate from keys, store labels in schema.json instead of encoding in keys.
 */
export const LEGACY_FIELD_KEY_MAP: Record<string, string> = {
	Description: 'description'
};

/**
 * Normalize a key using `LEGACY_FIELD_KEY_MAP`.
 *
 * @param key - Possibly-legacy schema/property key
 * @returns Canonical key
 */
export function normalizeFieldKey(key: string): string {
	return LEGACY_FIELD_KEY_MAP[key] ?? key;
}

/**
 * Migrate the schema.json structure to canonical key conventions.
 *
 * @param raw - Parsed JSON from schema.json
 * @returns migrated schema file and whether it changed
 */
export function migrateSchemaFile(raw: unknown): { file: SchemaFile; changed: boolean } {
	const parsed = SchemaFileSchema.parse(raw);
	let changed = false;

	const migrated: SchemaDefinition = {};
	for (const [key, def] of Object.entries(parsed.schema)) {
		const norm = normalizeFieldKey(key);
		migrated[norm] = def;
		if (norm !== key) changed = true;
	}

	return { file: { schema: migrated }, changed };
}

/** Error message thrown when a file-backed catalog still uses a pre-stable-ids on-disk layout. */
export const LEGACY_RECORD_ERROR =
	'media-manager: this data root predates stable file ids (a file-backed record is not keyed by a ' +
	'manifest `id` — it still has a `file_name` or `file_id`). ' +
	'Run `npm run upgrade-data -- <root> --apply` to migrate it.';

/**
 * Normalize a file-backed catalog (`image-data.json` / generic `data.json`) to the current on-disk
 * shape: rows keyed by `id` (the blob's manifest identity), legacy field keys canonicalized, no stored
 * `file_name`.
 *
 * This is **not** an auto-migration: the move to manifest-`id`-keyed rows is done explicitly by
 * `scripts/upgrade-data.mjs`. A row is considered un-migrated (and we **throw loudly** rather than
 * fabricate an identity) when it lacks a string `id`, or still carries a `file_name` (pre-stable-ids)
 * or a `file_id` (an earlier interim layout). This prevents silent corruption and tells the operator to
 * run the upgrade script.
 *
 * @param raw - Parsed JSON from the data file.
 * @returns The migrated file and whether anything changed (key normalization).
 * @throws {@link LEGACY_RECORD_ERROR} when a row is not in the current `id`-keyed shape.
 */
export function migrateImageDataFile(raw: unknown): { file: ImageDataFile; changed: boolean } {
	const LegacyImageDataFileSchema = z.object({
		images: z.array(z.record(z.any())).default([])
	});
	const parsed = LegacyImageDataFileSchema.parse(raw);
	let changed = false;

	const migratedImages: ImageRecord[] = [];

	for (const oldRecord of parsed.images ?? []) {
		const rec = oldRecord as Record<string, unknown>;
		if (typeof rec.id !== 'string' || rec.id.length === 0) {
			throw new Error(LEGACY_RECORD_ERROR);
		}
		// A migrated file-backed row stores neither the filename nor a `file_id` (name lives in the
		// manifest, identity lives in `id`). Either marks an un-migrated layout.
		if ('file_name' in rec || 'file_id' in rec) {
			throw new Error(LEGACY_RECORD_ERROR);
		}

		// Normalize legacy field keys.
		const migrated: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rec)) {
			const norm = normalizeFieldKey(k);
			migrated[norm] = v;
			if (norm !== k) changed = true;
		}
		if (typeof migrated.image_name !== 'string') migrated.image_name = '';

		migratedImages.push(ImageRecordSchema.parse(migrated) as ImageRecord);
	}

	return { file: ImageDataFileSchema.parse({ images: migratedImages }), changed };
}
