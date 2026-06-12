import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
	mintFileId,
	renameFileId,
	removeFileId,
	reconcile,
	readManifest,
	getFilenameForFileId
} from './manifest.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('global blob manifest', () => {
	beforeEach(() => {
		const root = path.join(tmpdir(), `mm-manifest-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		fs.mkdirSync(path.join(root, 'files'), { recursive: true });
		process.env.MEDIA_MANAGER_ROOT = root;
	});

	it('mintFileId is idempotent by name', async () => {
		const a = await mintFileId('photo.png');
		const b = await mintFileId('photo.png');
		expect(a).toBe(b);
		expect(UUID_RE.test(a)).toBe(true);
		const other = await mintFileId('other.png');
		expect(other).not.toBe(a);
	});

	it('renameFileId changes the name only, keeping the id stable', async () => {
		const id = await mintFileId('old.png');
		await renameFileId(id, 'new.png');
		expect(await getFilenameForFileId(id)).toBe('new.png');
		const manifest = await readManifest();
		expect(Object.keys(manifest.files)).toContain(id);
		expect(manifest.files[id].file_name).toBe('new.png');
	});

	it('renameFileId throws on an unknown id', async () => {
		await expect(renameFileId('00000000-0000-4000-8000-000000000000', 'x.png')).rejects.toThrow();
	});

	it('removeFileId deletes the entry', async () => {
		const id = await mintFileId('gone.png');
		await removeFileId(id);
		expect(await getFilenameForFileId(id)).toBeNull();
	});

	it('reconcile mints ids for new disk files and flags (without deleting) missing ones', async () => {
		const keep = await mintFileId('keep.png');

		// "missing.png" exists in the manifest but not on disk; "fresh.png" is new on disk.
		await mintFileId('missing.png');
		const result = await reconcile(['keep.png', 'fresh.png']);

		expect(result.added.map((a) => a.file_name)).toEqual(['fresh.png']);
		expect(result.missing.map((m) => m.file_name)).toContain('missing.png');

		// Missing entry is flagged, not removed.
		expect(await getFilenameForFileId(result.missing[0].file_id)).toBe('missing.png');
		// Existing id is unchanged; new id was minted.
		expect(await getFilenameForFileId(keep)).toBe('keep.png');
		const fresh = result.added[0].file_id;
		expect(UUID_RE.test(fresh)).toBe(true);
		expect(await getFilenameForFileId(fresh)).toBe('fresh.png');
	});

	it('reconcile is idempotent (no double-mint for an already-known name)', async () => {
		const first = await reconcile(['a.png']);
		const second = await reconcile(['a.png']);
		expect(first.added).toHaveLength(1);
		expect(second.added).toHaveLength(0);
		// The single id maps a.png across both runs.
		const m = await readManifest();
		expect(Object.values(m.files).filter((e) => e.file_name === 'a.png')).toHaveLength(1);
	});
});
