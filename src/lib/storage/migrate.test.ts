import { describe, expect, it } from 'vitest';
import { migrateSchemaFile, migrateImageDataFile } from './migrate.js';
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

	it('migrateImageDataFile adds id, drops linked=false, renames legacy keys', () => {
		const input = {
			images: [
				{
					file_name: 'a.jpg',
					image_name: 'A',
					Description: 'hello'
				}
			]
		};

		const { file, changed } = migrateImageDataFile(input);
		expect(changed).toBe(true);
		expect(file.images).toHaveLength(1);

		const rec = file.images[0]!;
		expect(ImageIdSchema.safeParse(rec.id).success).toBe(true);
		expect((rec as any).linked).toBeUndefined();
		expect((rec as any).description).toBe('hello');
		expect((rec as any).Description).toBeUndefined();
	});
});

