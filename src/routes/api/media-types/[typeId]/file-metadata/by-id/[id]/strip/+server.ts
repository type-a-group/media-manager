import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata, stripImageFileMetadata } from '$lib/server/fileMetadata.js';
import type { ImageRepo } from '$lib/storage/repo.js';
import { z } from 'zod';

const StripBodySchema = z.object({
	mode: z.enum(['all', 'gps'])
});

/**
 * POST: Strip metadata from the image (all or GPS only) for this media type.
 * Body: { mode: "all" | "gps" }.
 * Returns updated metadata JSON.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const parsed = StripBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Body must be { mode: "all" | "gps" }');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images' || !paths.filesDir) throw error(400, 'Not an images media type');
		const repo = getMediaTypeRepo(typeId) as ImageRepo;
		const filename = await repo.getFilenameForId(id.data);
		if (!filename) throw error(404, 'Image not found');

		await stripImageFileMetadata(paths.filesDir, filename, {
			all: parsed.data.mode === 'all',
			gpsOnly: parsed.data.mode === 'gps'
		});
		const metadata = await readImageFileMetadata(paths.filesDir, filename);
		return json(metadata);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const status = (e as { status?: number })?.status;
		if (status === 404) throw error(404, 'Image file not found');
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		const cause = (e as { cause?: unknown }).cause;
		const message = cause ? `${e.message}: ${cause}` : e.message;
		throw error(500, message || 'Failed to strip image metadata');
	}
};
