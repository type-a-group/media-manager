import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';

const BulkUpdateRequestSchema = z.object({
	ids: z.array(ImageIdSchema),
	patch: UpdatePropertiesRequestSchema
});

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const parsed = BulkUpdateRequestSchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid bulk update payload');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const updated = await repo.bulkUpdatePropertiesByIds(parsed.data.ids, parsed.data.patch);
		return json({ updated: updated.length });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to bulk update records' });
	}
};
