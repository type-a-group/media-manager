import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from './settingsFile.js';

describe('settingsFile displayField (persisted "title by")', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-settings-'));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('round-trips displayField through write/read', async () => {
		await writeMediaTypeSettingsFile(dir, { kind: 'json', schema: {}, displayName: 'Books' });
		expect(readMediaTypeSettingsFileSync(dir)?.displayField).toBeUndefined();

		await writeMediaTypeSettingsFile(dir, { kind: 'json', displayField: 'title' });
		const after = readMediaTypeSettingsFileSync(dir);
		expect(after?.displayField).toBe('title');
		// Other fields are preserved across the partial merge.
		expect(after?.displayName).toBe('Books');
	});

	it('clears displayField when written as undefined', async () => {
		await writeMediaTypeSettingsFile(dir, { kind: 'json', displayField: 'title' });
		await writeMediaTypeSettingsFile(dir, { kind: 'json', displayField: undefined });
		expect(readMediaTypeSettingsFileSync(dir)?.displayField).toBeUndefined();
	});

	it('round-trips subtitleField independently of displayField', async () => {
		await writeMediaTypeSettingsFile(dir, {
			kind: 'json',
			displayName: 'Books',
			displayField: 'title',
			subtitleField: 'author'
		});
		const after = readMediaTypeSettingsFileSync(dir);
		expect(after?.subtitleField).toBe('author');
		expect(after?.displayField).toBe('title');

		// Clearing the subtitle leaves the title intact.
		await writeMediaTypeSettingsFile(dir, { kind: 'json', subtitleField: undefined });
		const cleared = readMediaTypeSettingsFileSync(dir);
		expect(cleared?.subtitleField).toBeUndefined();
		expect(cleared?.displayField).toBe('title');
	});
});
