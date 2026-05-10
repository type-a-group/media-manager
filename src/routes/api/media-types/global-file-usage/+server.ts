import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCatalogTypesReferencingFileSync } from '$lib/storage/repo.js';

/**
 * GET: List media groups whose image catalogs reference one or more filenames on the global blob store.
 * Query: repeated `filename` params (basenames under `root/files/`).
 *
 * Returns `{ groups: { typeId, displayName }[] }` as the union of referencing groups across all filenames.
 *
 * Use case: confirm "delete from disk" may remove catalog rows in other groups; offer "exclude" instead.
 *
 * Concerns / future improvements:
 * - Large batches could use POST with a JSON body instead of long query strings.
 */
export const GET: RequestHandler = async ({ url }) => {
	const filenames = url.searchParams.getAll('filename').map((s) => s.trim()).filter(Boolean);
	if (filenames.length === 0) {
		throw error(400, 'At least one filename query parameter is required');
	}
	try {
		const byType = new Map<string, { typeId: string; displayName: string }>();
		for (const fn of filenames) {
			for (const g of listCatalogTypesReferencingFileSync(fn)) {
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
