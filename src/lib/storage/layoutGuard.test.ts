import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { detectOldLayout, assertCurrentLayout } from './layoutGuard.js';

/** Item 18 — read-only detection of the pre-reorg (flat) data-root layout. */
describe('layoutGuard — old-layout detection', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-guard-'));
		process.env.MEDIA_MANAGER_ROOT = root;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	function writeTypeFolder(dir: string) {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ kind: 'json', schema: {} }));
		fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ records: [] }));
	}

	it('passes on an empty root', () => {
		expect(detectOldLayout()).toBeNull();
		expect(() => assertCurrentLayout()).not.toThrow();
	});

	it('passes on the current layout (records/ + top-level globals + slim media/settings.json)', () => {
		writeTypeFolder(path.join(root, 'records', 'notes'));
		writeTypeFolder(path.join(root, 'globals')); // globals legitimately stays top-level
		fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ gridSize: 'large' }));
		fs.mkdirSync(path.join(root, 'media'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'media', 'settings.json'),
			JSON.stringify({ classOrder: ['a'] })
		);
		expect(detectOldLayout()).toBeNull();
	});

	it('flags a record type still at the top level (signal A)', () => {
		writeTypeFolder(path.join(root, 'notes'));
		const reason = detectOldLayout();
		expect(reason).toMatch(/notes/);
		expect(reason).toMatch(/top level/);
		expect(() => assertCurrentLayout()).toThrow(/upgrade-data/);
	});

	it('does NOT flag the reserved top-level globals folder', () => {
		writeTypeFolder(path.join(root, 'globals'));
		expect(detectOldLayout()).toBeNull();
	});

	it('flags app-wide keys lingering in media/settings.json (signal B)', () => {
		fs.mkdirSync(path.join(root, 'media'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'media', 'settings.json'),
			JSON.stringify({ gridSize: 'medium', classOrder: ['a'] })
		);
		expect(detectOldLayout()).toMatch(/app-wide/);
	});

	it('does NOT flag a media/settings.json that holds only classOrder', () => {
		fs.mkdirSync(path.join(root, 'media'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'media', 'settings.json'),
			JSON.stringify({ classOrder: ['a', 'b'] })
		);
		expect(detectOldLayout()).toBeNull();
	});
});
