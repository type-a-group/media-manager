import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { z } from 'zod';

const LinkBodySchema = z.object({ file_name: z.string().min(1) });

/**
 * POST: Add an existing file on disk to the catalog (images kind only).
 * Creates a record in image-data.json for the given file_name and returns it.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const parsed = LinkBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, 'file_name is required');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (!usesImageRepoKind(paths.kind)) throw error(400, 'Link only supported for file-backed media types');
		if (paths.kind === 'blob_store') throw error(400, 'Link to catalog is not supported for the global Files group');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/repo.js').ImageRepo;
		const record = await repo.ensureRecordForFilename(parsed.data.file_name);
		return json(JSON.parse(JSON.stringify(record)));
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to link image' });
	}
};
