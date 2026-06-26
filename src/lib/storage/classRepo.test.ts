import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
	createClass,
	deleteClass,
	classExists,
	listClasses,
	addMembers,
	removeMembers,
	updateRecord,
	getRecord,
	listAllFiles,
	listClassMembers,
	updateClassConfig
} from './classRepo.js';
import type { SchemaDefinition } from '$lib/core/types.js';

const schema = {
	caption: { type: 'string', removable: true, defaultValue: '' }
} as unknown as SchemaDefinition;

describe('classRepo — opt-in class membership', () => {
	let filesDir: string;
	beforeEach(() => {
		const root = path.join(
			tmpdir(),
			`mm-class-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
		);
		filesDir = path.join(root, 'media', 'files');
		fs.mkdirSync(filesDir, { recursive: true });
		fs.mkdirSync(path.join(root, 'media', 'classes'), { recursive: true });
		process.env.MEDIA_MANAGER_ROOT = root;
	});

	it('mints a file_id for a disk blob and starts it unclassified', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		const { files } = await listAllFiles();
		expect(files).toHaveLength(1);
		expect(files[0].file_name).toBe('a.png');
		expect(files[0].classes).toEqual([]);
	});

	it('round-trips membership, metadata, and the derived index', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		const fileId = (await listAllFiles()).files[0].id;

		const id = await createClass('Gallery', schema);
		expect(id).toBe('gallery');
		expect(classExists(id)).toBe(true);

		await addMembers(id, [fileId]);
		expect(listClasses().find((c) => c.id === id)?.count).toBe(1);

		// The manifest's derived index now reflects membership.
		expect((await listAllFiles()).files[0].classes).toEqual(['gallery']);

		// One-class catalog view shows the member.
		expect((await listClassMembers(id)).files.map((f) => f.id)).toEqual([fileId]);

		await updateRecord(id, fileId, { caption: 'hello' });
		expect((await getRecord(id, fileId))?.caption).toBe('hello');

		await removeMembers(id, [fileId]);
		expect((await listAllFiles()).files[0].classes).toEqual([]);
		expect(await getRecord(id, fileId)).toBeNull();
	});

	it('deleting a class leaves the blob (now unclassified) on disk', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		const fileId = (await listAllFiles()).files[0].id;
		const id = await createClass('Temp', schema);
		await addMembers(id, [fileId]);

		await deleteClass(id);
		expect(classExists(id)).toBe(false);
		const { files } = await listAllFiles();
		expect(files).toHaveLength(1);
		expect(files[0].classes).toEqual([]);
	});

	it('groups the multi-class "all of" listing by a chosen class field', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		const fileId = (await listAllFiles()).files[0].id;

		const images = await createClass('Images', schema);
		const docs = await createClass('Documents', {
			description: { type: 'string', removable: true, defaultValue: '' }
		} as unknown as SchemaDefinition);
		await addMembers(images, [fileId]);
		await addMembers(docs, [fileId]);
		await updateRecord(docs, fileId, { description: 'Scenic' });

		// Intersection of both classes, grouped by the Documents field.
		const { files } = await listAllFiles({
			classIds: [images, docs],
			matchAll: true,
			groupBy: { classId: docs, field: 'description' }
		});
		expect(files.map((f) => f.id)).toEqual([fileId]);
		expect(files[0].group_by_value).toBe('Scenic');

		// Without groupBy the value is absent.
		const plain = await listAllFiles({ classIds: [images, docs], matchAll: true });
		expect(plain.files[0].group_by_value).toBeUndefined();
	});

	it('an empty-schema class is a valid pure tag', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		const fileId = (await listAllFiles()).files[0].id;
		const id = await createClass('Favorites');
		await addMembers(id, [fileId]);
		const rec = await getRecord(id, fileId);
		expect(rec).not.toBeNull();
		expect((await listAllFiles()).files[0].classes).toEqual(['favorites']);
	});

	it('searches a single class by field value, by All-fields, and respects field scope', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		fs.writeFileSync(path.join(filesDir, 'b.png'), 'y');
		const files0 = (await listAllFiles()).files;
		const aId = files0.find((f) => f.file_name === 'a.png')!.id;
		const bId = files0.find((f) => f.file_name === 'b.png')!.id;
		const id = await createClass('Gallery', schema);
		await addMembers(id, [aId, bId]);
		await updateRecord(id, aId, { caption: 'sunset' });
		await updateRecord(id, bId, { caption: 'mountain' });

		// Field-scoped: only the caption field is matched.
		expect(
			(await listClassMembers(id, { query: 'sun', searchField: 'caption' })).files.map((f) => f.id)
		).toEqual([aId]);
		// All-fields (no searchField) also matches the filename.
		expect((await listClassMembers(id, { query: 'b.png' })).files.map((f) => f.id)).toEqual([bId]);
		// A field-scoped query ignores the filename: 'a.png' won't match the caption field.
		expect(
			(await listClassMembers(id, { query: 'a.png', searchField: 'caption' })).files
		).toHaveLength(0);
	});

	it('searches an intersection by classId::field and by All-fields', async () => {
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'x');
		fs.writeFileSync(path.join(filesDir, 'b.png'), 'y');
		const files0 = (await listAllFiles()).files;
		const aId = files0.find((f) => f.file_name === 'a.png')!.id;
		const bId = files0.find((f) => f.file_name === 'b.png')!.id;
		const images = await createClass('Images', schema);
		const docs = await createClass('Documents', {
			description: { type: 'string', removable: true, defaultValue: '' }
		} as unknown as SchemaDefinition);
		await addMembers(images, [aId, bId]);
		await addMembers(docs, [aId, bId]);
		await updateRecord(docs, aId, { description: 'invoice' });
		await updateRecord(docs, bId, { description: 'receipt' });

		// Specific field of the docs class via the classId::field encoding.
		const byField = await listAllFiles({
			classIds: [images, docs],
			matchAll: true,
			query: 'invo',
			searchField: `${docs}::description`
		});
		expect(byField.files.map((f) => f.id)).toEqual([aId]);

		// All-fields intersection search reaches the docs field too.
		const all = await listAllFiles({ classIds: [images, docs], matchAll: true, query: 'receipt' });
		expect(all.files.map((f) => f.id)).toEqual([bId]);
	});

	it('sorts the All Files listing by filename ascending and descending (Item 9)', async () => {
		for (const n of ['c.png', 'a.png', 'b.png']) fs.writeFileSync(path.join(filesDir, n), 'x');
		const asc = (await listAllFiles({ sortField: 'name', sortDir: 'asc' })).files.map(
			(f) => f.file_name
		);
		expect(asc).toEqual(['a.png', 'b.png', 'c.png']);
		const desc = (await listAllFiles({ sortField: 'name', sortDir: 'desc' })).files.map(
			(f) => f.file_name
		);
		expect(desc).toEqual(['c.png', 'b.png', 'a.png']);
	});

	it('sorts class members by a schema field, composes with search, and sorts empties last', async () => {
		for (const n of ['a.png', 'b.png', 'c.png']) fs.writeFileSync(path.join(filesDir, n), 'x');
		const files0 = (await listAllFiles()).files;
		const byName = Object.fromEntries(files0.map((f) => [f.file_name, f.id]));
		const id = await createClass('Gallery', schema);
		await addMembers(
			id,
			files0.map((f) => f.id)
		);
		await updateRecord(id, byName['a.png'], { caption: 'zebra' });
		await updateRecord(id, byName['b.png'], { caption: 'apple' });
		// c.png has no caption → empty, must sort last in BOTH directions.
		const asc = (await listClassMembers(id, { sortField: 'caption', sortDir: 'asc' })).files.map(
			(f) => f.file_name
		);
		expect(asc).toEqual(['b.png', 'a.png', 'c.png']); // apple, zebra, then empty
		const desc = (await listClassMembers(id, { sortField: 'caption', sortDir: 'desc' })).files.map(
			(f) => f.file_name
		);
		expect(desc).toEqual(['a.png', 'b.png', 'c.png']); // zebra, apple, empty still last

		// Composes with a field-scoped search: only 'apple' contains 'p', still under the chosen sort.
		const searched = (
			await listClassMembers(id, {
				query: 'p',
				searchField: 'caption',
				sortField: 'caption',
				sortDir: 'asc'
			})
		).files.map((f) => f.file_name);
		expect(searched).toEqual(['b.png']);
	});

	it('honors a class config sort default when no sort param is given', async () => {
		for (const n of ['a.png', 'b.png', 'c.png']) fs.writeFileSync(path.join(filesDir, n), 'x');
		const files0 = (await listAllFiles()).files;
		const id = await createClass('Gallery', schema);
		await addMembers(
			id,
			files0.map((f) => f.id)
		);
		await updateClassConfig(id, { sortField: 'name', sortDir: 'desc' });
		const names = (await listClassMembers(id)).files.map((f) => f.file_name);
		expect(names).toEqual(['c.png', 'b.png', 'a.png']);
	});
});
