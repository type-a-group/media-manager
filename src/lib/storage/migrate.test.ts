import { describe, expect, it } from 'vitest';
import { migrateSchemaFile, migrateImageDataFile, LEGACY_RECORD_ERROR } from './migrate.js';
import { ImageIdSchema } from '$lib/core/ids.js';

describe('storage migrations', () => {
	it('migrateSchemaFile renames legacy keys', () => {
		const input = {
			schema: {
				Description: { type: 'string', removable: true, defaultValue: '' },
				stars: { type: 'number', removable: true, defaultValue: 0 }
			}
		};

		const { file, changed } = migrateSchemaFile(input);
		expect(changed).toBe(true);
		expect(file.schema).toHaveProperty('description');
		expect(file.schema).toHaveProperty('stars');
		expect(file.schema).not.toHaveProperty('Description');
	});

	it('migrateImageDataFile throws on a legacy row that still has a file_name', () => {
		const input = {
			images: [{ id: '11111111-1111-4111-8111-111111111111', file_name: 'a.jpg', image_name: 'A' }]
		};
		expect(() => migrateImageDataFile(input)).toThrow(LEGACY_RECORD_ERROR);
	});

	it('migrateImageDataFile throws on an interim row keyed by file_id', () => {
		const input = {
			images: [{ file_id: '22222222-2222-4222-8222-222222222222', image_name: 'A' }]
		};
		expect(() => migrateImageDataFile(input)).toThrow(LEGACY_RECORD_ERROR);
	});

	it('migrateImageDataFile passes id-keyed rows through, normalizing legacy field keys', () => {
		const id = '22222222-2222-4222-8222-222222222222';
		const input = {
			images: [{ id, image_name: 'A', Description: 'hello' }]
		};

		const { file, changed } = migrateImageDataFile(input);
		expect(changed).toBe(true);
		expect(file.images).toHaveLength(1);

		const rec = file.images[0]!;
		expect(ImageIdSchema.safeParse(rec.id).success).toBe(true);
		expect(rec.id).toBe(id);
		expect((rec as any).file_name).toBeUndefined();
		expect((rec as any).file_id).toBeUndefined();
		expect((rec as any).description).toBe('hello');
		expect((rec as any).Description).toBeUndefined();
	});
});
