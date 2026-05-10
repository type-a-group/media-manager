import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { FilterClauseSchema } from '$lib/core/filters.js';
import { z } from 'zod';

const FiltersParamSchema = z.array(FilterClauseSchema);

/**
 * GET: List records for this media type.
 * For kind 'images' or 'generic': returns ImageListResponse.
 * For kind 'json': returns { records } (JsonListResponse).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		const groupBy = url.searchParams.get('groupBy') || undefined;

		const filtersRaw = url.searchParams.get('filters');
		let filters: z.infer<typeof FiltersParamSchema> | null = null;
		if (filtersRaw) {
			try {
				const parsed = JSON.parse(filtersRaw);
				filters = FiltersParamSchema.parse(Array.isArray(parsed) ? parsed : []);
			} catch {
				// invalid filters: ignore
			}
		}

		if (usesImageRepoKind(paths.kind)) {
			const imageRepo = repo as import('$lib/storage/repo.js').ImageRepo;
			if (filters != null && filters.length > 0) {
				const data = await imageRepo.listImages({ filters, groupBy });
				return json(data);
			}
			const query = url.searchParams.get('query');
			const field = url.searchParams.get('field');
			const empty = url.searchParams.get('empty') === 'true';
			const data = await imageRepo.listImages({ query, field, empty, groupBy });
			return json(data);
		}

		const jsonRepo = repo as import('$lib/storage/jsonRepo.js').JsonRepo;
		const data = await jsonRepo.listRecords({ filters: filters ?? undefined, groupBy });
		return json(data);
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to list records' });
	}
};
