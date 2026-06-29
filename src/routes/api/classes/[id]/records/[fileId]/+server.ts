import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';
import { getRecord, updateRecord } from '$lib/storage/classRepo.js';

/** GET: One blob's record within a class (404 if not a member). */
export const GET: RequestHandler = async ({ params }) => {
	const fileId = ImageIdSchema.safeParse(params.fileId);
	if (!fileId.success) throw error(400, 'Invalid id');
	try {
		const rec = await getRecord(params.id, fileId.data);
		if (!rec) throw error(404, 'Not a member of this class');
		return json(rec);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to get record' });
	}
};

/** PATCH: Update a member's metadata fields. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const fileId = ImageIdSchema.safeParse(params.fileId);
	if (!fileId.success) throw error(400, 'Invalid id');
	const patch = UpdatePropertiesRequestSchema.safeParse(await request.json());
	if (!patch.success) throw error(400, 'Invalid properties payload');
	try {
		return json(await updateRecord(params.id, fileId.data, patch.data));
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Not a member')) throw error(404, e.message);
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to update record' });
	}
};
