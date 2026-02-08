import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';

/**
 * GET unique values for a field across all image records.
 * Used for list field autocomplete (e.g. tags).
 *
 * Query params:
 * - field: required, the schema field name
 */
export const GET: RequestHandler = async ({ url }) => {
	const field = url.searchParams.get('field');
	if (!field || typeof field !== 'string') {
		throw error(400, 'Missing or invalid field parameter');
	}

	try {
		const values = await imageRepo.getUniqueFieldValues(field);
		return json({ values });
	} catch {
		throw error(500, { message: 'Failed to fetch field values' });
	}
};
