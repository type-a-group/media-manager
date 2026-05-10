import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata } from '$lib/server/fileMetadata.js';

/**
 * GET: Return extracted file metadata by record id (images kind only).
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (!usesImageRepoKind(paths.kind) || !paths.filesDir) throw error(400, 'Not a file-backed media type');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/repo.js').ImageRepo;
		const filename = await repo.getFilenameForId(id.data);
		if (!filename) throw error(404, 'Image not found');
		const metadata = await readImageFileMetadata(paths.filesDir, filename);
		return json(metadata);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const status = (e as { status?: number })?.status;
		if (status === 404) throw error(404, 'Image file not found');
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, 'Failed to read image metadata');
	}
};
