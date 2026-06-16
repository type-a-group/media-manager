import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUniqueFieldValues } from '$lib/storage/classRepo.js';

/** GET: Unique values for a field across a class's members (autocomplete / filters). */
export const GET: RequestHandler = async ({ params, url }) => {
	const field = url.searchParams.get('field');
	if (!field) throw error(400, 'Missing field parameter');
	try {
		return json({ values: await getUniqueFieldValues(params.id, field) });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to fetch field values' });
	}
};
