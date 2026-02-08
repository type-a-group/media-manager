import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';

/**
 * DELETE: Delete the image file from disk and remove its record from image-data.json.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	try {
		await imageRepo.deleteFromDiskById(id.data);
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to delete image';
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};
