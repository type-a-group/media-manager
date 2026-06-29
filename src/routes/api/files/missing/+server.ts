import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMissingFileReferences, type MissingFileRef } from '$lib/storage/classRepo.js';

/**
 * GET: The global missing-files warning surface — every dangling reference to an absent blob, grouped
 * per missing blob. Powers the app-wide warning + drill-down (filename → impacted records).
 */
export const GET: RequestHandler = async () => {
	try {
		const refs = await listMissingFileReferences();
		const byFile = new Map<
			string,
			{ file_id: string; file_name: string; refs: MissingFileRef[] }
		>();
		for (const ref of refs) {
			let group = byFile.get(ref.file_id);
			if (!group) {
				group = { file_id: ref.file_id, file_name: ref.file_name, refs: [] };
				byFile.set(ref.file_id, group);
			}
			group.refs.push(ref);
		}
		const files = [...byFile.values()];
		return json({ count: files.length, files });
	} catch (err) {
		console.error('Missing files error:', err);
		throw error(500, { message: 'Failed to compute missing files' });
	}
};
