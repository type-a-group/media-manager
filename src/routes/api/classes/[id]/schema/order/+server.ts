import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reorderSchemaFields } from '$lib/storage/classRepo.js';
import { ReorderFieldsRequestSchema } from '$lib/core/types.js';

/**
 * POST: Reorder this class's schema fields. Body `{ order: string[] }` is the desired field-key
 * order; the server rewrites the schema object so its keys follow it (omitted keys are appended).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = ReorderFieldsRequestSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid reorder payload');
	try {
		const result = await reorderSchemaFields(params.id, parsed.data.order);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const msg = (err as Error)?.message;
		if (msg?.includes('not found')) throw error(404, 'Class not found');
		if (msg?.includes('Invalid class id')) throw error(400, msg);
		throw error(500, { message: 'Failed to reorder fields' });
	}
};
