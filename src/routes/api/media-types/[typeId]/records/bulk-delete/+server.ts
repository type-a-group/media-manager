import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { z } from 'zod';
import { ImageIdSchema } from '$lib/core/ids.js';
import { unlinkRecordEverywhere } from '$lib/storage/relationLinks.js';

const BulkDeleteRequestSchema = z.object({ ids: z.array(ImageIdSchema) });

/** POST: Delete many `json` records. */
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = BulkDeleteRequestSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid bulk delete payload');
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Globals record cannot be deleted');
		const repo = getMediaTypeRepo(typeId);
		// Drop each record from every blob's linked record field BEFORE deleting it (refs must still be
		// readable) — parity with the single-record DELETE. No-op for types without linked file fields.
		for (const id of parsed.data.ids) await unlinkRecordEverywhere(typeId, id);
		await repo.bulkDeleteRecordsByIds(parsed.data.ids);
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to bulk delete records' });
	}
};
