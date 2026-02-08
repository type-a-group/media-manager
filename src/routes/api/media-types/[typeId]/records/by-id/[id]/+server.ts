import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';

/**
 * GET: Return record (properties) by id.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const rec = await repo.getRecordById(id.data);
		if (!rec) throw error(404, 'Record not found');
		return json(rec);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to get record' });
	}
};

/**
 * POST: Update record properties.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	const body = await request.json();
	const patch = UpdatePropertiesRequestSchema.safeParse(body);
	if (!patch.success) throw error(400, 'Invalid properties payload');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const updated = await repo.updatePropertiesById(id.data, patch.data);
		return json(updated);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const msg = (e as Error)?.message;
		if (msg === 'Record not found') throw error(404, msg);
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to update record' });
	}
};

/**
 * DELETE: For images: unlink (remove record, file stays). For json: delete record.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		if (paths.kind === 'images') {
			const imageRepo = repo as import('$lib/storage/repo.js').ImageRepo;
			await imageRepo.unlinkById(id.data);
		} else {
			const jsonRepo = repo as import('$lib/storage/jsonRepo.js').JsonRepo;
			await jsonRepo.deleteRecord(id.data);
		}
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const msg = (e as Error)?.message;
		if (msg?.includes('not found')) throw error(404, msg);
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to delete record' });
	}
};
