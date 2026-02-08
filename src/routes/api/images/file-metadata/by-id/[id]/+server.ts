import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { imageRepo } from '$lib/server/imageRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata } from '$lib/server/fileMetadata.js';

/**
 * Return extracted file metadata by `imageId`.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	const filename = await imageRepo.getFilenameForId(id.data);
	if (!filename) throw error(404, 'Image not found');

	try {
		const metadata = await readImageFileMetadata(imageRepo.paths.imagesDir, filename);
		return json(metadata);
	} catch (e) {
		const status = (e as any)?.status;
		if (status === 404) throw error(404, 'Image file not found');
		throw error(500, 'Failed to read image metadata');
	}
};

