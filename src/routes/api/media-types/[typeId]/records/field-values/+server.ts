import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';

/**
 * GET: Unique values for a field across all records (for autocomplete).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const field = url.searchParams.get('field');
	if (!field || typeof field !== 'string') {
		throw error(400, 'Missing or invalid field parameter');
	}
	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const values = await repo.getUniqueFieldValues(field);
		return json({ values });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to fetch field values' });
	}
};
