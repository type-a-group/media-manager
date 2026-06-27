import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import path from 'node:path';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { getEntryDimensions } from '$lib/storage/manifest.js';
import { dimensionConsistency } from '$lib/server/fileMetadata.js';
import { ImageIdSchema } from '$lib/core/ids.js';

/**
 * GET: Compare a blob's stored dimensions against the real (orientation-corrected) image (Item 13).
 * Drives the "stored dimensions look wrong" warning badge + the smart fix. Fails safe — any read
 * problem yields `mismatch: false` rather than a server error.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	const filename = await getFilenameForId(id.data);
	if (!filename) throw error(404, 'File not found');
	const stored = await getEntryDimensions(id.data);
	const check = await dimensionConsistency(path.join(getGlobalFilesDir(), filename), stored);
	return json(check);
};
