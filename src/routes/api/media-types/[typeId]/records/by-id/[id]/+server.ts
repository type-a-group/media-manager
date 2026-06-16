import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
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
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
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

/** DELETE: Delete a `json` record. */
export const DELETE: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Globals record cannot be deleted');
		const repo = getMediaTypeRepo(typeId);
		await repo.deleteRecord(id.data);
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
