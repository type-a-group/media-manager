import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import * as fs from 'node:fs/promises';

/**
 * GET: Stats for this `json` media type: record count, kind, and last updated (data file mtime).
 * Returns { recordCount, kind, lastUpdated }.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const repo = getMediaTypeRepo(params.typeId);
		const paths = getMediaTypePaths(params.typeId);
		const data = await repo.listRecords({});
		const recordCount = data.records.length;

		let lastUpdated: string | null = null;
		try {
			const stat = await fs.stat(paths.dataPath);
			lastUpdated = new Date(stat.mtime).toISOString();
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code !== 'ENOENT') throw err;
		}
		return json({ recordCount, kind: paths.kind, lastUpdated });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to get stats' });
	}
};
