import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { ALLOWED_IMAGE_MIME_TYPES } from '$lib/core/images.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';

/**
 * POST: Upload an image file (images kind only).
 * Accepts multipart/form-data with an 'image' field.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images' || !paths.filesDir) throw error(400, 'Upload only supported for images media type');
		const imagesDirPath = paths.filesDir;

		const formData = await request.formData();
		const imageFile = formData.get('image') as File;
		if (!imageFile) throw error(400, 'No image file provided');
		if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(imageFile.type)) {
			throw error(400, 'Invalid file type. Only JPEG, PNG, GIF, and SVG images are allowed.');
		}
		if (!fs.existsSync(imagesDirPath)) {
			fs.mkdirSync(imagesDirPath, { recursive: true });
		}
		const safeFileName = assertSafeImageFilename(imageFile.name);
		const targetPath = path.join(imagesDirPath, safeFileName);
		const arrayBuffer = await imageFile.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		fs.writeFileSync(targetPath, buffer);
		// Do not add to catalog; file appears in unlinked list. User can "Link to catalog" to add.
		const unlinkedId = `unlinked:${encodeURIComponent(safeFileName)}`;
		return json({
			success: true,
			id: unlinkedId,
			filename: safeFileName,
			message: 'Image uploaded successfully'
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		console.error('Upload error:', e);
		throw error(500, { message: e.message ?? 'Upload failed' });
	}
};
