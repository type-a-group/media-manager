import { z } from 'zod';
import {
	SchemaFileSchema,
	type SchemaFile,
	type SchemaDefinition,
	ImageDataFileSchema,
	type ImageDataFile,
	type ImageRecord
} from '$lib/core/types.js';
import { newImageId } from '$lib/core/ids.js';

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

/**
 * Migrate the image-data.json structure:
 * - add stable `id` to each record if missing
 * - normalize legacy field keys on each record
 *
 * @param raw - Parsed JSON from image-data.json
 * @returns migrated image data file and whether it changed
 */
export function migrateImageDataFile(raw: unknown): { file: ImageDataFile; changed: boolean } {
	// We intentionally accept legacy records here (they may not have `id` yet).
	const LegacyImageDataFileSchema = z.object({
		images: z.array(z.record(z.any())).default([])
	});
	const parsed = LegacyImageDataFileSchema.parse(raw);
	let changed = false;

	const seenIds = new Set<string>();
	const migratedImages: ImageRecord[] = [];

	for (const oldRecord of parsed.images ?? []) {
		let id = (oldRecord as any).id as string | undefined;
		if (!id || typeof id !== 'string' || id.length === 0) {
			id = newImageId();
			changed = true;
		}

		// Ensure uniqueness; if collision, regenerate.
		while (seenIds.has(id)) {
			id = newImageId();
			changed = true;
		}
		seenIds.add(id);

		// Normalize keys.
		const migrated: Record<string, any> = {};
		for (const [k, v] of Object.entries(oldRecord)) {
			const norm = normalizeFieldKey(k);
			migrated[norm] = v;
			if (norm !== k) changed = true;
		}

		migrated.id = id;

		// Ensure required fields exist.
		if (typeof migrated.file_name !== 'string' || migrated.file_name.length === 0) {
			migrated.file_name = migrated.file_name || '__unknown__';
			changed = true;
		}
		if (typeof migrated.image_name !== 'string') migrated.image_name = '';

		migratedImages.push(migrated as ImageRecord);
	}

	return { file: ImageDataFileSchema.parse({ images: migratedImages }), changed };
}


