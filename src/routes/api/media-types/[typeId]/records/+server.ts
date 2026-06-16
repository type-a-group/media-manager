import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';

/**
 * POST: Create a new record (JSON kind only).
 * Returns the created record with id.
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Globals supports exactly one record');
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'json')
			throw error(400, 'Create record only supported for JSON media types');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/jsonRepo.js').JsonRepo;
		const record = await repo.createRecord();
		// Ensure a plain serializable object so response never fails to serialize (avoids client "Failed to create record" despite record existing).
		const body = JSON.parse(JSON.stringify(record));
		return json(body);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to create record' });
	}
};
