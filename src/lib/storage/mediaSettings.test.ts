import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { readMediaSettings, writeMediaSettings, DEFAULT_MEDIA_SETTINGS } from './mediaSettings.js';
import { getAppSettingsPath, getMediaSettingsPath } from './paths.js';

/**
 * Item 18 — app-wide settings live in `<root>/settings.json`, NOT `media/settings.json`.
 * The media-scoped `media/settings.json` is reserved for the dormant `classOrder` and is not
 * touched by these read/write paths.
 */
describe('mediaSettings — app-wide settings backed by <root>/settings.json', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-appsettings-'));
		process.env.MEDIA_MANAGER_ROOT = root;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('returns defaults when no settings file exists', () => {
		expect(readMediaSettings()).toEqual(DEFAULT_MEDIA_SETTINGS);
	});

	it('writes to <root>/settings.json, not media/settings.json', async () => {
		await writeMediaSettings({ gridSize: 'large' });
		expect(fs.existsSync(getAppSettingsPath())).toBe(true);
		expect(fs.existsSync(getMediaSettingsPath())).toBe(false);
		expect(path.dirname(getAppSettingsPath())).toBe(root);
	});

	it('round-trips app-wide prefs through write/read', async () => {
		await writeMediaSettings({ gridSize: 'small', sortField: 'name', sortDir: 'asc' });
		const s = readMediaSettings();
		expect(s.gridSize).toBe('small');
		expect(s.sortField).toBe('name');
		expect(s.sortDir).toBe('asc');
	});

	it('preserves unknown keys already on disk across a partial merge', async () => {
		fs.writeFileSync(getAppSettingsPath(), JSON.stringify({ gridSize: 'large', someFuture: 42 }));
		await writeMediaSettings({ autoAdvanceToNextUnlinked: true });
		const onDisk = JSON.parse(fs.readFileSync(getAppSettingsPath(), 'utf-8'));
		expect(onDisk.someFuture).toBe(42);
		expect(onDisk.gridSize).toBe('large');
		expect(onDisk.autoAdvanceToNextUnlinked).toBe(true);
	});

	it('does not read classOrder out of an old media/settings.json', async () => {
		// Simulate the old (pre-migration) location holding app-wide keys + classOrder.
		fs.mkdirSync(path.dirname(getMediaSettingsPath()), { recursive: true });
		fs.writeFileSync(
			getMediaSettingsPath(),
			JSON.stringify({ gridSize: 'large', classOrder: ['a', 'b'] })
		);
		// The app reads the (absent) root settings.json → defaults, ignoring the old file entirely.
		expect(readMediaSettings().gridSize).toBe(DEFAULT_MEDIA_SETTINGS.gridSize);
		expect('classOrder' in readMediaSettings()).toBe(false);
	});
});
