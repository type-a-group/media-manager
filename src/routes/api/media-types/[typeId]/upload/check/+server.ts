import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';
import path from 'node:path';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { z } from 'zod';

const CheckBodySchema = z.object({
	filenames: z.array(z.string().min(1))
});

/**
 * POST: Check which filenames already exist on disk (for upload conflict detection).
 * Returns { conflicts: string[] } with filenames that would conflict.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images' || !paths.filesDir)
			throw error(400, 'Upload check only supported for images media type');

		const body = await request.json();
		const parsed = CheckBodySchema.safeParse(body);
		if (!parsed.success) throw error(400, 'filenames array is required');

		const conflicts: string[] = [];
		for (const filename of parsed.data.filenames) {
			const filePath = path.join(paths.filesDir, path.basename(filename));
			if (fs.existsSync(filePath)) {
				conflicts.push(filename);
			}
		}

		return json({ conflicts });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		console.error('Upload check error:', e);
		throw error(500, { message: e.message ?? 'Upload check failed' });
	}
};
