import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata, stripImageFileMetadata } from '$lib/server/fileMetadata.js';
import { z } from 'zod';

const StripBodySchema = z.object({
	mode: z.enum(['all', 'gps'])
});

/**
 * POST: Strip metadata from the image (all or GPS only).
 * Body: { mode: "all" | "gps" }.
 * Returns updated metadata JSON.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const parsed = StripBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Body must be { mode: "all" | "gps" }');

	const filename = await imageRepo.getFilenameForId(id.data);
	if (!filename) throw error(404, 'Image not found');

	try {
		await stripImageFileMetadata(imageRepo.paths.imagesDir, filename, {
			all: parsed.data.mode === 'all',
			gpsOnly: parsed.data.mode === 'gps'
		});
		const metadata = await readImageFileMetadata(imageRepo.paths.imagesDir, filename);
		return json(metadata);
	} catch (e) {
		const status = (e as any)?.status;
		if (status === 404) throw error(404, 'Image file not found');
		const message = e instanceof Error ? e.message : 'Failed to strip image metadata';
		const cause = e instanceof Error && (e as any).cause ? String((e as any).cause) : '';
		throw error(500, cause ? `${message}: ${cause}` : message);
	}
};
