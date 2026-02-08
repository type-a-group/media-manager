import { describe, expect, it, beforeAll } from 'vitest';
import { createImageRepo } from './repo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('imageRepo basic behavior', () => {
	const testDir = path.join(tmpdir(), `media-manager-repo-test-${Date.now()}`);

	beforeAll(() => {
		fs.mkdirSync(testDir, { recursive: true });
		fs.mkdirSync(path.join(testDir, 'images'), { recursive: true });
		process.env.MEDIA_MANAGER_ROOT = testDir;
	});

	it('can list images without throwing', async () => {
		const repo = createImageRepo();
		const result = await repo.listImages();
		expect(result).toHaveProperty('linked');
		expect(result).toHaveProperty('unlinked');
		expect(result).toHaveProperty('missing_files');
	});

	it('can round-trip schema get', async () => {
		const repo = createImageRepo();
		const schema = await repo.getSchema();
		expect(schema).toBeTypeOf('object');
	});
});

