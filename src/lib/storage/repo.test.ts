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

	it('an on-disk blob gets a stable file_id and renames via the manifest only', async () => {
		const repo = createImageRepo(typeId);
		const blobPath = path.join(testDir, 'files', 'rename-me.png');
		fs.writeFileSync(blobPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // dummy bytes

		// Lazy heal mints a file_id; the file shows up as unlinked with a UUID id.
		const first = await repo.listImages();
		const item = first.unlinked.find((i) => i.file_name === 'rename-me.png');
		expect(item).toBeTruthy();
		const fileId = item!.id;
		expect(fileId).toMatch(/^[0-9a-f-]{36}$/i);

		// Identity is stable across list calls.
		const second = await repo.listImages();
		expect(second.unlinked.find((i) => i.file_name === 'rename-me.png')?.id).toBe(fileId);

		// Rename is a manifest + disk operation only — id is unchanged, new name resolves.
		await repo.renameFileById(fileId, 'renamed.png');
		expect(fs.existsSync(path.join(testDir, 'files', 'rename-me.png'))).toBe(false);
		expect(fs.existsSync(path.join(testDir, 'files', 'renamed.png'))).toBe(true);
		const after = await repo.listImages();
		const renamed = after.unlinked.find((i) => i.id === fileId);
		expect(renamed?.file_name).toBe('renamed.png');
	});
});
