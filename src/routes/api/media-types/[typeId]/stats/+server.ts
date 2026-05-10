import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import * as fs from 'node:fs/promises';

/**
 * GET: Return stats for this media type: record count, kind, and last updated (data file mtime).
 * Use case: Info popup on the home page to show amount of images/records, group type, and last updated.
 *
 * Returns: { recordCount: number, kind: 'images' | 'json' | 'generic', lastUpdated: string | null }
 * lastUpdated is ISO string of data file mtime, or null if file does not exist.
 *
 * Concerns / future improvements:
 * - For very large datasets, consider a count-only path instead of loading full list.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);

		let recordCount: number;
		if (usesImageRepoKind(paths.kind)) {
			const imageRepo = repo as import('$lib/storage/repo.js').ImageRepo;
			const data = await imageRepo.listImages({});
			recordCount = data.linked.length + data.unlinked.length;
		} else {
			const jsonRepo = repo as import('$lib/storage/jsonRepo.js').JsonRepo;
			const data = await jsonRepo.listRecords({});
			recordCount = data.records.length;
		}

		let lastUpdated: string | null = null;
		try {
			const stat = await fs.stat(paths.dataPath);
			lastUpdated = new Date(stat.mtime).toISOString();
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'ENOENT') throw err;
		}

		return json({
			recordCount,
			kind: paths.kind,
			lastUpdated
		});
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to get stats' });
	}
};
