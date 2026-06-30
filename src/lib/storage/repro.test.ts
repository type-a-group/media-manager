import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { createMediaType } from './mediaTypes.js';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import type { JsonRepo } from './jsonRepo.js';

describe('repro: create record with date field', () => {
	let root: string;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-repro-'));
		process.env.MEDIA_MANAGER_ROOT = root;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('creates a record after adding a date field', async () => {
		const id = await createMediaType('Events');
		const repo = getMediaTypeRepo(id) as JsonRepo;
		await repo.addSchemaField('When', 'date', undefined);
		const rec = await repo.createRecord();
		expect(rec.id).toBeTruthy();
	});

	it('creates a record after adding a record-type field', async () => {
		const target = await createMediaType('People');
		const id = await createMediaType('Events');
		const repo = getMediaTypeRepo(id) as JsonRepo;
		await repo.addSchemaField('Owner', 'record', undefined, undefined, undefined, false, false, target);
		const rec = await repo.createRecord();
		expect(rec.id).toBeTruthy();
	});
});
