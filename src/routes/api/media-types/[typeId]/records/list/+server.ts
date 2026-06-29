import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { FilterClauseSchema } from '$lib/core/filters.js';
import { z } from 'zod';

const FiltersParamSchema = z.array(FilterClauseSchema);

/** GET: List records for this `json` media type → { records } (JsonListResponse). */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const repo = getMediaTypeRepo(params.typeId);
		const groupBy = url.searchParams.get('groupBy') || undefined;
		const titleField = url.searchParams.get('titleField') || undefined;
		const subtitleField = url.searchParams.get('subtitleField') || undefined;
		const searchQuery = url.searchParams.get('searchQuery') || undefined;
		const searchField = url.searchParams.get('searchField') || undefined;
		const sortField = url.searchParams.get('sort') || undefined;
		const sortDirRaw = url.searchParams.get('dir');
		const sortDir = sortDirRaw === 'asc' || sortDirRaw === 'desc' ? sortDirRaw : undefined;
		// Incomplete filter (Item 10): `?incomplete=1` → only records with ≥1 empty user field.
		const incomplete = url.searchParams.get('incomplete') === '1';
		// Verbose grid (Item 8): `?fields=a,b,c` → inline those field values on each row as `field_values`.
		const fieldsRaw = url.searchParams.get('fields');
		const fields = fieldsRaw
			? fieldsRaw
					.split(',')
					.map((f) => f.trim())
					.filter(Boolean)
			: undefined;

		const filtersRaw = url.searchParams.get('filters');
		let filters: z.infer<typeof FiltersParamSchema> | undefined;
		if (filtersRaw) {
			try {
				filters = FiltersParamSchema.parse(JSON.parse(filtersRaw));
			} catch {
				/* invalid filters: ignore */
			}
		}
		return json(
			await repo.listRecords({
				filters,
				groupBy,
				titleField,
				subtitleField,
				searchQuery,
				searchField,
				sortField,
				sortDir,
				incomplete,
				fields
			})
		);
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to list records' });
	}
};
