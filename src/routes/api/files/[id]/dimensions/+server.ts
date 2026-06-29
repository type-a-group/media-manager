import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { setBlobDimensions } from '$lib/storage/manifest.js';
import { ImageIdSchema } from '$lib/core/ids.js';

/** Positive-integer width/height (the corrected or swapped dimensions to persist). */
const DimensionsBodySchema = z.object({
	width: z.number().int().positive(),
	height: z.number().int().positive()
});

/**
 * POST: Explicitly set a blob's intrinsic dimensions in the manifest (Item 13 "correct / swap").
 * A deliberate user correction — overwrites whatever is stored; the lazy backfill won't clobber it.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	const parsed = DimensionsBodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'width and height must be positive integers');
	const filename = await getFilenameForId(id.data);
	if (!filename) throw error(404, 'File not found');
	try {
		await setBlobDimensions(id.data, parsed.data);
		return json({ success: true, width: parsed.data.width, height: parsed.data.height });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Unknown file_id')) throw error(404, 'File not found');
		throw error(500, { message: e.message ?? 'Failed to set dimensions' });
	}
};
