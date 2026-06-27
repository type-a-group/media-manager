import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { getEntryDimensions } from '$lib/storage/manifest.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata, compareStoredVsImage } from '$lib/server/fileMetadata.js';

/** GET: Intrinsic EXIF/file metadata for a blob (the info bubble), plus the Item 13 dimension check. */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	try {
		const filename = await getFilenameForId(id.data);
		if (!filename) throw error(404, 'File not found');
		const metadata = await readImageFileMetadata(getGlobalFilesDir(), filename);
		// Reuse the dims/orientation already read above — no second exiftool read.
		const stored = await getEntryDimensions(id.data);
		const dimensionCheck = compareStoredVsImage(
			stored,
			{ width: metadata.width, height: metadata.height },
			typeof metadata.orientation === 'number' ? metadata.orientation : undefined
		);
		return json({ ...metadata, dimensionCheck });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const status = (err as { status?: number })?.status;
		if (status === 404) throw error(404, 'File not found');
		throw error(500, 'Failed to read file metadata');
	}
};
