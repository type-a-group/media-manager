import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';
import { updateClassRecordLinked } from '$lib/storage/relationLinks.js';

const BulkUpdateSchema = z.object({
	ids: z.array(ImageIdSchema).min(1),
	patch: UpdatePropertiesRequestSchema
});

/** POST: Set the same fields on many members of a class. */
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = BulkUpdateSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid bulk update payload');
	try {
		// Route each member through the link-aware wrapper so a bulk-set of a linked `record` field
		// mirrors onto the partner type's file field. Falls through to a bare write when not linked.
		for (const fileId of parsed.data.ids)
			await updateClassRecordLinked(params.id, fileId, parsed.data.patch);
		return json({ updated: parsed.data.ids.length });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to bulk update records' });
	}
};
