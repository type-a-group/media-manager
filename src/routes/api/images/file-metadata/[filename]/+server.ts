import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readImageFileMetadata } from '$lib/server/fileMetadata.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';
import { imageRepo } from '$lib/server/imageRepo.js';

/**
 * GET handler for extracting actual image file metadata.
 * Reads EXIF data, dimensions, color space, and other file properties.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;

	if (!filename) {
		throw error(400, 'Filename is required');
	}
	const safe = assertSafeImageFilename(filename);
	try {
		const metadata = await readImageFileMetadata(imageRepo.paths.imagesDir, safe);
		return json(metadata);
	} catch (e) {
		const status = (e as any)?.status;
		if (status === 404) throw error(404, 'Image file not found');
		throw error(500, 'Failed to read image metadata');
	}
};