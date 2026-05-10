import { describe, expect, it, beforeAll } from 'vitest';
import { createImageRepo } from './repo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('imageRepo basic behavior', () => {
	const testDir = path.join(tmpdir(), `media-manager-repo-test-${Date.now()}`);
	const typeId = 'test-images';
	const typeDir = path.join(testDir, typeId);

	beforeAll(() => {
		fs.mkdirSync(typeDir, { recursive: true });
		process.env.MEDIA_MANAGER_ROOT = testDir;
		// Create a valid media-type settings file
		fs.writeFileSync(
			path.join(typeDir, 'settings.json'),
			JSON.stringify({
				kind: 'images',
				schema: {},
				dataFileName: 'image-data.json'
			})
		);
		// Create the global files directory
		fs.mkdirSync(path.join(testDir, 'files'), { recursive: true });
	});

	it('can list images without throwing', async () => {
		const repo = createImageRepo(typeId);
		const result = await repo.listImages();
		expect(result).toHaveProperty('linked');
		expect(result).toHaveProperty('unlinked');
		expect(result).toHaveProperty('missing_files');
	});

	it('can round-trip schema get', async () => {
		const repo = createImageRepo(typeId);
		const schema = await repo.getSchema();
		expect(schema).toBeTypeOf('object');
	});
});
