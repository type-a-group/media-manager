import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCatalogTypesReferencingFileIdSync } from '$lib/storage/repo.js';

/**
 * GET: List media groups whose catalogs reference one or more blobs (by `file_id`) on the global store.
 * Query: repeated `file_id` params (the blobs' manifest ids).
 *
 * Returns `{ groups: { typeId, displayName }[] }` as the union of referencing groups across all ids.
 *
 * Use case: confirm "delete from disk" may remove catalog rows in other groups; offer "exclude" instead.
 *
 * Concerns / future improvements:
 * - Large batches could use POST with a JSON body instead of long query strings.
 */
export const GET: RequestHandler = async ({ url }) => {
	const fileIds = url.searchParams.getAll('file_id').map((s) => s.trim()).filter(Boolean);
	if (fileIds.length === 0) {
		throw error(400, 'At least one file_id query parameter is required');
	}
	try {
		const byType = new Map<string, { typeId: string; displayName: string }>();
		for (const fid of fileIds) {
			for (const g of listCatalogTypesReferencingFileIdSync(fid)) {
				byType.set(g.typeId, g);
			}
		}
		return json({ groups: [...byType.values()] });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		console.error('global-file-usage error:', e);
		throw error(500, { message: 'Failed to resolve file usage' });
	}
};
