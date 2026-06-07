import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';

const BulkDeleteRequestSchema = z.object({
	ids: z.array(ImageIdSchema)
});

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const parsed = BulkDeleteRequestSchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Invalid bulk delete payload');

	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		if (usesImageRepoKind(paths.kind)) {
			const imageRepo = repo as import('$lib/storage/repo.js').ImageRepo;
			await imageRepo.bulkUnlinkByIds(parsed.data.ids);
		} else {
			if (typeId === 'globals') throw error(403, 'Globals record cannot be deleted');
			const jsonRepo = repo as import('$lib/storage/jsonRepo.js').JsonRepo;
			await jsonRepo.bulkDeleteRecordsByIds(parsed.data.ids);
		}
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to bulk delete records' });
	}
};
