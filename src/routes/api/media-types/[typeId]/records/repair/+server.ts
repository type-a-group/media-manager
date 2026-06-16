import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Repair not supported for globals');

		const body = await request.json().catch(() => ({}));
		const dryRun = body.dryRun ?? true;

		const repo = getMediaTypeRepo(typeId);
		if (!('repairRecords' in repo)) {
			throw error(400, 'Repair not supported for this media type');
		}

		const result = await (repo as any).repairRecords(dryRun);
		return json(result);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to repair records' });
	}
};
