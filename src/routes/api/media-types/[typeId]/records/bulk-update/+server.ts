import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';
import { updateTypeRecordLinked } from '$lib/storage/relationLinks.js';

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
		// Route each record through the link-aware wrapper so a bulk-set of a linked `file` field mirrors
		// onto the partner class's record field — parity with the single-record POST. Falls through to a
		// bare write per record when no linked field is touched.
		for (const id of parsed.data.ids) await updateTypeRecordLinked(typeId, id, parsed.data.patch);
		return json({ updated: parsed.data.ids.length });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to bulk update records' });
	}
};
