import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAllFiles } from '$lib/storage/classRepo.js';

/**
 * GET: The All Files hub listing — every blob with derived class chips.
 *
 * Query params:
 * - `query`        — filename substring search.
 * - `classIds`     — comma-separated class ids to filter by.
 * - `match`        — `all` | `any` (default `any`) for multi-class filtering.
 * - `unclassified` — `true` to show only blobs with zero class memberships.
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const query = url.searchParams.get('query');
		const classIdsRaw = url.searchParams.get('classIds');
		const classIds = classIdsRaw
			? classIdsRaw
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: null;
		const matchAll = url.searchParams.get('match') === 'all';
		const unclassified = url.searchParams.get('unclassified') === 'true';
		const data = await listAllFiles({ query, classIds, matchAll, unclassified });
		return json(data);
	} catch (err) {
		console.error('List files error:', err);
		throw error(500, { message: 'Failed to list files' });
	}
};
