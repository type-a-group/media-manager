import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';

const BulkDeleteDiskRequestSchema = z.object({
	ids: z.array(ImageIdSchema)
});

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const parsed = BulkDeleteDiskRequestSchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid bulk delete disk payload');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		if (usesImageRepoKind(paths.kind)) {
			const imageRepo = repo as import('$lib/storage/repo.js').ImageRepo;
			await imageRepo.bulkDeleteFromDiskByIds(parsed.data.ids);
		} else {
			throw error(400, 'Delete from disk not supported for this media type');
		}
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to bulk delete from disk' });
	}
};
