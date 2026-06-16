import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';
import { bulkUpdateRecords } from '$lib/storage/classRepo.js';

const BulkUpdateSchema = z.object({
	ids: z.array(ImageIdSchema).min(1),
	patch: UpdatePropertiesRequestSchema
});

/** POST: Set the same fields on many members of a class. */
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = BulkUpdateSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid bulk update payload');
	try {
		await bulkUpdateRecords(params.id, parsed.data.ids, parsed.data.patch);
		return json({ updated: parsed.data.ids.length });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to bulk update records' });
	}
};
