import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Item 18 — end-to-end test of the `upgrade-data` records reorg + settings split (Step 6). Drives the
 * real script against a throwaway old-layout root and asserts the resulting tree + idempotency.
 */
const SCRIPT = path.resolve('scripts/upgrade-data.mjs');

/** Run the upgrade script; returns { code, out }. */
function run(root: string, apply: boolean): { code: number; out: string } {
	try {
		const out = execFileSync('node', [SCRIPT, root, ...(apply ? ['--apply'] : [])], {
			encoding: 'utf-8'
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

describe('upgrade-data — records reorg + settings split (Item 18)', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-migrate-'));
		// Pre-Item-18 layout (already file-first on the media side).
		fs.mkdirSync(path.join(root, 'media', 'files'), { recursive: true });
		fs.mkdirSync(path.join(root, 'media', 'classes'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'media', 'manifest.json'),
			JSON.stringify({ version: 2, files: {} })
		);
		// media/settings.json mixes app-wide prefs with the media-scoped classOrder.
		fs.writeFileSync(
			path.join(root, 'media', 'settings.json'),
			JSON.stringify({ gridSize: 'large', railCollapsed: true, classOrder: ['images'] })
		);
		// A top-level json record type with the dead dataFileName.
		fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'notes', 'settings.json'),
			JSON.stringify({ kind: 'json', displayName: 'Notes', schema: {}, dataFileName: 'data.json' })
		);
		fs.writeFileSync(
			path.join(root, 'notes', 'data.json'),
			JSON.stringify({ records: [{ id: 'r1' }] })
		);
		// Reserved globals singleton, top-level, also carrying dataFileName.
		fs.mkdirSync(path.join(root, 'globals'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'globals', 'settings.json'),
			JSON.stringify({
				kind: 'json',
				displayName: 'Globals',
				schema: {},
				dataFileName: 'data.json'
			})
		);
		fs.writeFileSync(
			path.join(root, 'globals', 'data.json'),
			JSON.stringify({ records: [{ id: '00000000-0000-4000-8000-000000000001' }] })
		);
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('dry-run reports pending changes without touching disk', () => {
		const { code } = run(root, false);
		expect(code).toBe(1); // pending upgrades
		// Nothing moved.
		expect(fs.existsSync(path.join(root, 'notes'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'records'))).toBe(false);
		expect(fs.existsSync(path.join(root, 'settings.json'))).toBe(false);
	});

	it('--apply produces the new layout', () => {
		run(root, true);

		// Record type moved under records/, top-level copy gone.
		expect(fs.existsSync(path.join(root, 'records', 'notes', 'settings.json'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'records', 'notes', 'data.json'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'notes'))).toBe(false);

		// dataFileName stripped from the moved type AND from globals.
		expect('dataFileName' in readJson(path.join(root, 'records', 'notes', 'settings.json'))).toBe(
			false
		);
		expect('dataFileName' in readJson(path.join(root, 'globals', 'settings.json'))).toBe(false);

		// App-wide prefs hoisted to <root>/settings.json.
		const appSettings = readJson(path.join(root, 'settings.json'));
		expect(appSettings.gridSize).toBe('large');
		expect(appSettings.railCollapsed).toBe(true);
		expect('classOrder' in appSettings).toBe(false);

		// media/settings.json keeps only classOrder.
		const mediaSettings = readJson(path.join(root, 'media', 'settings.json'));
		expect(mediaSettings).toEqual({ classOrder: ['images'] });

		// records/settings.json created (empty dormant typeOrder home).
		expect(readJson(path.join(root, 'records', 'settings.json'))).toEqual({});

		// Globals stays top-level, untouched in location.
		expect(fs.existsSync(path.join(root, 'globals', 'data.json'))).toBe(true);
		expect(fs.existsSync(path.join(root, 'records', 'globals'))).toBe(false);
	});

	it('is idempotent — a second run finds nothing to do', () => {
		run(root, true);
		const second = run(root, false); // dry-run after apply
		expect(second.code).toBe(0); // no pending upgrades
		expect(second.out).toMatch(/up to date/);
	});

	it('flags a colliding top-level type named "records" as a conflict', () => {
		fs.rmSync(path.join(root, 'notes'), { recursive: true, force: true });
		fs.mkdirSync(path.join(root, 'records'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'records', 'settings.json'),
			JSON.stringify({ kind: 'json', schema: {} })
		);
		const { out } = run(root, false);
		expect(out).toMatch(/collides with the new records\/ container/);
	});
});
