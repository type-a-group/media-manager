import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';

/**
 * Legacy endpoint (compat): previously compared disk filenames to JSON entries.
 *
 * New behavior:
 * - Returns the same conceptual grouping, but as typed list items with `imageId`.
 * - Prefer `GET /api/images/list` going forward.
 */
export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('query');
	const field = url.searchParams.get('field');
	const empty = url.searchParams.get('empty') === 'true';

	const data = await imageRepo.listImages({ query, field, empty });

	// Preserve old keys for callers, but with richer items.
	return json({
		inBoth: data.linked,
		inAssetsOnly: data.unlinked,
		inJsonOnly: data.missing_files
	});
};