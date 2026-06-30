import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { ReorderFieldsRequestSchema } from '$lib/core/types.js';

/**
 * POST: Reorder a media type's schema fields. Body `{ order: string[] }` is the desired field-key
 * order; the server rewrites the schema object so its keys follow it (omitted keys are appended).
 * Not editable for the reserved `globals` singleton.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		if (params.typeId === 'globals') throw error(403, 'Schema is not editable for globals');
		const parsed = ReorderFieldsRequestSchema.safeParse(await request.json());
		if (!parsed.success) throw error(400, 'Invalid reorder payload');

		const repo = getMediaTypeRepo(params.typeId);
		const result = await repo.reorderSchemaFields(parsed.data.order);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const msg = (err as Error)?.message;
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to reorder fields' });
	}
};
