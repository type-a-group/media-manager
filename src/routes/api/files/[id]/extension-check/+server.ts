import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import path from 'node:path';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { extensionConsistency } from '$lib/server/fileMetadata.js';
import { ImageIdSchema } from '$lib/core/ids.js';

/**
 * GET: Compare a blob's name extension against its sniffed (magic-byte) type (Item 12). Drives the
 * "extension doesn't match content" warning badge + the one-tap fix. Cheap (reads only the first
 * bytes, no exiftool) and fails safe — any read problem yields `mismatch: false`, never a 500.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	const filename = await getFilenameForId(id.data);
	if (!filename) throw error(404, 'File not found');
	const check = await extensionConsistency(path.join(getGlobalFilesDir(), filename), filename);
	return json(check);
};
