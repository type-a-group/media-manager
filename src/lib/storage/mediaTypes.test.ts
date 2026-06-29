import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { createMediaType, deleteMediaType, listMediaTypes } from './mediaTypes.js';
import { getMediaTypeBaseDir, getMediaTypePaths, listMediaTypeIds } from './paths.js';

/**
 * Item 18 — record types live under `<root>/records/<typeId>/`; the reserved `globals` singleton
 * stays top-level at `<root>/globals/`.
 */
describe('mediaTypes / paths — records/ layout (Item 18)', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-records-'));
		process.env.MEDIA_MANAGER_ROOT = root;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('creates a record type under records/<typeId>/ with data.json', async () => {
		const id = await createMediaType('Notes');
		expect(id).toBe('notes');
		const baseDir = getMediaTypeBaseDir('notes');
		expect(baseDir).toBe(path.join(root, 'records', 'notes'));
		expect(fs.existsSync(path.join(baseDir, 'settings.json'))).toBe(true);
		expect(fs.existsSync(path.join(baseDir, 'data.json'))).toBe(true);
		// Not at the old top-level location.
		expect(fs.existsSync(path.join(root, 'notes'))).toBe(false);
	});

	it('settings.json carries no dataFileName key', async () => {
		await createMediaType('Notes');
		const raw = JSON.parse(
			fs.readFileSync(path.join(getMediaTypeBaseDir('notes'), 'settings.json'), 'utf-8')
		);
		expect('dataFileName' in raw).toBe(false);
	});

	it('getMediaTypePaths resolves records/<typeId>/data.json', async () => {
		await createMediaType('Notes');
		const paths = getMediaTypePaths('notes');
		expect(paths.baseDir).toBe(path.join(root, 'records', 'notes'));
		expect(paths.dataPath).toBe(path.join(root, 'records', 'notes', 'data.json'));
	});

	it('listMediaTypeIds scans records/ and folds in top-level globals', async () => {
		await createMediaType('Notes');
		await createMediaType('Books');
		// Simulate the reserved globals singleton sitting top-level.
		const gdir = getMediaTypeBaseDir('globals');
		expect(gdir).toBe(path.join(root, 'globals'));
		fs.mkdirSync(gdir, { recursive: true });
		fs.writeFileSync(
			path.join(gdir, 'settings.json'),
			JSON.stringify({ kind: 'json', schema: {} })
		);

		const ids = listMediaTypeIds().sort();
		expect(ids).toEqual(['books', 'globals', 'notes']);
		expect(
			listMediaTypes()
				.map((t) => t.id)
				.sort()
		).toEqual(['books', 'globals', 'notes']);
	});

	it('returns empty when records/ is absent (no throw)', () => {
		expect(listMediaTypeIds()).toEqual([]);
	});

	it('rejects reserved folder names as typeIds', async () => {
		await expect(createMediaType('media')).rejects.toThrow(/reserved/);
		await expect(createMediaType('records')).rejects.toThrow(/reserved/);
		await expect(createMediaType('globals')).rejects.toThrow(/reserved/);
	});

	it('deletes a record type under records/', async () => {
		await createMediaType('Notes');
		await deleteMediaType('notes');
		expect(fs.existsSync(getMediaTypeBaseDir('notes'))).toBe(false);
	});
});
