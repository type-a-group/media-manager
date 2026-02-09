import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { z } from 'zod';

const RenameBodySchema = z.object({ new_filename: z.string().min(1) });

/**
 * POST: Rename an image file (both on disk and in image-data.json).
 * Returns the updated record on success, 409 if target filename exists.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	const body = await request.json();
	const parsed = RenameBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, 'new_filename is required');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images') throw error(400, 'Rename only supported for images media type');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/repo.js').ImageRepo;
		const record = await repo.renameFileById(id.data, parsed.data.new_filename);
		return json({ success: true, record });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			const e = err as { status: number; message?: string };
			if (e.status === 409) throw error(409, 'Target filename already exists');
			throw err as never;
		}
		const e = err as Error;
		if (e.message?.includes('Target filename already exists')) throw error(409, e.message);
		if (e.message?.includes('not found')) throw error(404, e.message);
		if (e.message?.includes('Invalid filename') || e.message?.includes('Unsupported image extension'))
			throw error(400, e.message);
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		console.error('Rename error:', e);
		throw error(500, { message: e.message ?? 'Rename failed' });
	}
};
