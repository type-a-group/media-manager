import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import { FilterClauseSchema } from '$lib/core/filters.js';
import { z } from 'zod';

const FiltersParamSchema = z.array(FilterClauseSchema);

/**
 * List images grouped by linked/unlinked status.
 *
 * Query params:
 * - `filters`: JSON array of { field, operator, value? }; when present, overrides query/field/empty
 * - `query`: search substring (legacy)
 * - `field`: field to search/filter (legacy)
 * - `empty`: if true, filter linked images where field is empty (legacy)
 * - `groupBy`: when set, each list item includes group_by_value for that schema field (for grid group-by)
 */
export const GET: RequestHandler = async ({ url }) => {
	const groupBy = url.searchParams.get('groupBy') || undefined;

	const filtersRaw = url.searchParams.get('filters');
	let filters: z.infer<typeof FiltersParamSchema> | null = null;
	if (filtersRaw) {
		try {
			const parsed = JSON.parse(filtersRaw);
			filters = FiltersParamSchema.parse(Array.isArray(parsed) ? parsed : []);
		} catch {
			// Invalid JSON or shape: treat as no filters, fall back to legacy params
		}
	}

	if (filters != null && filters.length > 0) {
		const data = await imageRepo.listImages({ filters, groupBy });
		return json(data);
	}

	const query = url.searchParams.get('query');
	const field = url.searchParams.get('field');
	const empty = url.searchParams.get('empty') === 'true';
	const data = await imageRepo.listImages({ query, field, empty, groupBy });
	return json(data);
};

