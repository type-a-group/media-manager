import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
	createClass,
	addSchemaField,
	addMembers,
	removeMembers,
	getRecord,
	listAllFiles,
	deleteFromDiskById,
	getClassSchema
} from './classRepo.js';
import { createMediaType } from './mediaTypes.js';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import {
	reconcileClassRecordLinks,
	updateClassRecordLinked,
	updateTypeRecordLinked,
	unlinkBlobFromClass,
	unlinkBlobEverywhere,
	unlinkRecordEverywhere,
	backfillClassLinks,
	reconcileLinkData,
	previewLinkData,
	isValidLinkCounterpart
} from './relationLinks.js';
import { updateRecord } from './classRepo.js';
import type { SchemaDefinition } from '$lib/core/types.js';

/**
 * Two-way linked relations: a class `photos` `record` field `album` (→ type `albums`, single) paired
 * with `albums`' `file` field `shots` (classId=photos, multiselect). Exercises the propagation engine
 * from both sides + the single-side "move" semantics.
 */
describe('relationLinks — two-way propagation', () => {
	let filesDir: string;
	let blobA: string;
	let blobB: string;
	let albumsId: string;
	let a1: string;
	let a2: string;

	/** Build the linked pair + two member blobs + two album records; return their ids. */
	async function setup() {
		// Class with a member-less schema; type `albums` with a class-scoped multiselect file field.
		await createClass('Photos', {} as SchemaDefinition);
		albumsId = await createMediaType('Albums');
		const albums = getMediaTypeRepo(albumsId);
		await albums.addSchemaField('title', 'string', '');
		// shots: file field, scoped to class `photos`, multiselect.
		await albums.addSchemaField(
			'shots',
			'file',
			[],
			undefined,
			undefined,
			true,
			false,
			undefined,
			'photos'
		);
		// album: record field on photos → albums (single), declared linked to `shots`.
		await addSchemaField(
			'photos',
			'album',
			'record',
			'',
			undefined,
			undefined,
			false,
			false,
			albumsId,
			undefined,
			'shots'
		);
		// Mirror the back-link onto `albums.shots` (shots.linkedField = 'album').
		await reconcileClassRecordLinks('photos');

		// Two member blobs.
		fs.writeFileSync(path.join(filesDir, 'a.png'), 'a');
		fs.writeFileSync(path.join(filesDir, 'b.png'), 'b');
		const files = (await listAllFiles()).files;
		blobA = files.find((f) => f.file_name === 'a.png')!.id;
		blobB = files.find((f) => f.file_name === 'b.png')!.id;
		await addMembers('photos', [blobA, blobB]);

		// Two album records.
		const r1 = await albums.createRecord();
		await albums.updatePropertiesById(r1.id, { title: 'Trip' });
		const r2 = await albums.createRecord();
		await albums.updatePropertiesById(r2.id, { title: 'Beach' });
		a1 = r1.id;
		a2 = r2.id;
	}

	/** Read the current `shots` array of an album record. */
	async function shotsOf(recordId: string): Promise<string[]> {
		const rec = await getMediaTypeRepo(albumsId).getRecordById(recordId);
		const v = (rec as Record<string, unknown> | null)?.shots;
		return Array.isArray(v) ? (v as string[]) : v ? [v as string] : [];
	}

	beforeEach(() => {
		const root = path.join(
			tmpdir(),
			`mm-link-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
		);
		filesDir = path.join(root, 'media', 'files');
		fs.mkdirSync(filesDir, { recursive: true });
		fs.mkdirSync(path.join(root, 'media', 'classes'), { recursive: true });
		fs.mkdirSync(path.join(root, 'records'), { recursive: true });
		process.env.MEDIA_MANAGER_ROOT = root;
	});

	it('reconcile mirrors the back-link onto the counterpart file field', async () => {
		await setup();
		const schema = await getMediaTypeRepo(albumsId).getSchema();
		expect((schema.shots as { linkedField?: string }).linkedField).toBe('album');
		expect(isValidLinkCounterpart('photos', albumsId, 'shots')).toBe(true);
	});

	it('class-side edit mirrors onto the type side', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);
		expect((await getRecord('photos', blobA))?.album).toBe(a1);
	});

	it('type-side edit mirrors onto the class side', async () => {
		await setup();
		await updateTypeRecordLinked(albumsId, a1, { shots: [blobA, blobB] });
		expect((await getRecord('photos', blobA))?.album).toBe(a1);
		expect((await getRecord('photos', blobB))?.album).toBe(a1);
	});

	it('single-side reassign moves the link (steals from the previous record)', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);

		// Re-point the (single) album field — abc moves from Trip to Beach.
		await updateClassRecordLinked('photos', blobA, { album: a2 });
		expect(await shotsOf(a2)).toEqual([blobA]);
		expect(await shotsOf(a1)).toEqual([]); // dropped from the old record
		expect((await getRecord('photos', blobA))?.album).toBe(a2);
	});

	it('adding from the type side also steals from the previous record (single class field)', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);

		// Add blobA to a2.shots from the type side — class field is single, so it moves.
		await updateTypeRecordLinked(albumsId, a2, { shots: [blobA] });
		expect((await getRecord('photos', blobA))?.album).toBe(a2);
		expect(await shotsOf(a1)).toEqual([]); // the old record lost it
	});

	it('clearing the ref removes the partner edge', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);

		await updateClassRecordLinked('photos', blobA, { album: '' });
		expect(await shotsOf(a1)).toEqual([]);
		expect((await getRecord('photos', blobA))?.album ?? '').toBe('');
	});

	it('removing one file from a multiselect file field clears just that blob', async () => {
		await setup();
		await updateTypeRecordLinked(albumsId, a1, { shots: [blobA, blobB] });
		expect((await getRecord('photos', blobA))?.album).toBe(a1);
		expect((await getRecord('photos', blobB))?.album).toBe(a1);

		await updateTypeRecordLinked(albumsId, a1, { shots: [blobB] });
		expect((await getRecord('photos', blobA))?.album ?? '').toBe(''); // removed
		expect((await getRecord('photos', blobB))?.album).toBe(a1); // kept
	});

	it('cascade: removing a member from the class drops it from the linked record', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);

		await unlinkBlobFromClass('photos', blobA);
		await removeMembers('photos', [blobA]);
		expect(await shotsOf(a1)).toEqual([]); // the album no longer lists the removed blob
	});

	it('cascade: deleting a blob from disk drops it from the linked record', async () => {
		await setup();
		await updateClassRecordLinked('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([blobA]);

		await unlinkBlobEverywhere(blobA);
		await deleteFromDiskById(blobA);
		expect(await shotsOf(a1)).toEqual([]);
	});

	it('cascade: deleting a record clears it from every linked blob', async () => {
		await setup();
		await updateTypeRecordLinked(albumsId, a1, { shots: [blobA, blobB] });
		expect((await getRecord('photos', blobA))?.album).toBe(a1);

		await unlinkRecordEverywhere(albumsId, a1);
		await getMediaTypeRepo(albumsId).deleteRecord(a1);
		expect((await getRecord('photos', blobA))?.album ?? '').toBe('');
		expect((await getRecord('photos', blobB))?.album ?? '').toBe('');
	});

	it('backfill mirrors pre-existing one-sided refs onto the counterpart', async () => {
		await setup();
		// Set the class record field directly (bare write — no propagation), as if it pre-dated the link.
		await updateRecord('photos', blobA, { album: a1 });
		expect(await shotsOf(a1)).toEqual([]); // not yet mirrored

		await backfillClassLinks('photos');
		expect(await shotsOf(a1)).toEqual([blobA]); // backfilled
	});

	it('previewLinkData reports per-side mismatch counts without mutating', async () => {
		await setup();
		await updateRecord('photos', blobA, { album: a1 }); // class-only edge
		await getMediaTypeRepo(albumsId).updatePropertiesById(a2, { shots: [blobB] }); // type-only edge
		const p = await previewLinkData('photos', 'album', albumsId, 'shots');
		expect(p.classOnly).toBe(1);
		expect(p.typeOnly).toBe(1);
		// Nothing changed.
		expect((await getRecord('photos', blobB))?.album ?? '').toBe('');
		expect(await shotsOf(a1)).toEqual([]);
	});

	it('reconcile keep-class rebuilds the type side from the record field', async () => {
		await setup();
		await updateRecord('photos', blobA, { album: a1 }); // class-only edge
		await getMediaTypeRepo(albumsId).updatePropertiesById(a2, { shots: [blobB] }); // type-only edge
		await reconcileLinkData('photos', 'album', 'class');
		expect(await shotsOf(a1)).toEqual([blobA]); // mirrored from class
		expect(await shotsOf(a2)).toEqual([]); // type-only edge dropped
		expect((await getRecord('photos', blobB))?.album ?? '').toBe(''); // class side preserved
	});

	it('reconcile keep-type rebuilds the record field from the file field', async () => {
		await setup();
		await updateRecord('photos', blobA, { album: a1 }); // class-only edge
		await getMediaTypeRepo(albumsId).updatePropertiesById(a2, { shots: [blobB] }); // type-only edge
		await reconcileLinkData('photos', 'album', 'type');
		expect((await getRecord('photos', blobB))?.album).toBe(a2); // built from type
		expect((await getRecord('photos', blobA))?.album ?? '').toBe(''); // class-only edge dropped
		expect(await shotsOf(a2)).toEqual([blobB]);
		expect(await shotsOf(a1)).toEqual([]);
	});

	it('flags an out-of-class file reference (blob exists but is not a member)', async () => {
		await setup();
		// A third blob that is NOT a member of the `photos` class.
		fs.writeFileSync(path.join(filesDir, 'c.png'), 'c');
		const blobC = (await listAllFiles()).files.find((f) => f.file_name === 'c.png')!.id;
		// Point the class-scoped `shots` field at the non-member blob (bare write, no propagation).
		await getMediaTypeRepo(albumsId).updatePropertiesById(a1, { shots: [blobC] });
		const rec = await getMediaTypeRepo(albumsId).getRecordById(a1);
		expect((rec as { _out_of_class?: Record<string, string> })._out_of_class).toMatchObject({
			shots: 'photos'
		});
	});

	it('cascade: deleting the linked file field unlinks the class record field', async () => {
		await setup();
		await getMediaTypeRepo(albumsId).deleteSchemaField('shots', false);
		// onFileFieldDeleted runs in the endpoint; emulate it here via the schema cascade.
		const { onFileFieldDeleted } = await import('./relationLinks.js');
		// Field is gone, so emulate the captured def the endpoint would have passed.
		await onFileFieldDeleted({
			type: 'file',
			removable: true,
			classId: 'photos',
			linkedField: 'album'
		} as never);
		const schema = await getClassSchema('photos');
		expect((schema.album as { linkedField?: string }).linkedField).toBeUndefined();
	});
});
