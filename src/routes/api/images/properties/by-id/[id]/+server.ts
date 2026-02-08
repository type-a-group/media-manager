import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { imageRepo } from '$lib/server/imageRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';

/**
 * GET/POST properties by `imageId`.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	const rec = await imageRepo.getRecordById(id.data);
	if (!rec) throw error(404, 'Image record not found');

	return json(rec);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	const body = await request.json();
	const patch = UpdatePropertiesRequestSchema.safeParse(body);
	if (!patch.success) throw error(400, 'Invalid properties payload');

	const updated = await imageRepo.updatePropertiesById(id.data, patch.data);
	return json({ success: true, properties: updated });
};

