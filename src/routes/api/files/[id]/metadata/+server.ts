import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata } from '$lib/server/fileMetadata.js';

/** GET: Intrinsic EXIF/file metadata for a blob (the info bubble). */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	try {
		const filename = await getFilenameForId(id.data);
		if (!filename) throw error(404, 'File not found');
		const metadata = await readImageFileMetadata(getGlobalFilesDir(), filename);
		return json(metadata);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const status = (err as { status?: number })?.status;
		if (status === 404) throw error(404, 'File not found');
		throw error(500, 'Failed to read file metadata');
	}
};
