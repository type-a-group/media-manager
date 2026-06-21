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
 * - `groupByClass` + `groupByField` — group the result by one class's field (the "all of" view);
 *   each item gets a `group_by_value` read from that class's record.
 * - `searchField` — scope `query`: empty = filename (or All fields in an intersection);
 *   `<classId>::<field>` = one field of one intersected class.
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
		const groupByClass = url.searchParams.get('groupByClass');
		const groupByField = url.searchParams.get('groupByField');
		const searchField = url.searchParams.get('searchField');
		const idPattern = /^[a-zA-Z0-9_-]+$/;
		const groupBy =
			groupByClass && groupByField && idPattern.test(groupByClass)
				? { classId: groupByClass, field: groupByField }
				: null;
		const data = await listAllFiles({
			query,
			classIds,
			matchAll,
			unclassified,
			groupBy,
			searchField
		});
		return json(data);
	} catch (err) {
		console.error('List files error:', err);
		throw error(500, { message: 'Failed to list files' });
	}
};
