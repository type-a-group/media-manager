import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getMediaTypePaths, usesImageRepoKind } from '$lib/storage/paths.js';
import { ALLOWED_IMAGE_MIME_TYPES } from '$lib/core/images.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';
import { generateUniqueFilename } from '$lib/storage/repo.js';
import { mintFileId } from '$lib/storage/manifest.js';
import convert from 'heic-convert';

/** HEIC/HEIF MIME types that require conversion. */
const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

/** Check if a MIME type is HEIC/HEIF. */
function isHeicMime(mime: string): boolean {
	return HEIC_MIME_TYPES.includes(mime.toLowerCase());
}

/** Check if a filename has a HEIC/HEIF extension. */
function isHeicExtension(filename: string): boolean {
	const ext = path.extname(filename).toLowerCase();
	return ext === '.heic' || ext === '.heif';
}

/**
 * POST: Upload a file (images: images only; generic: any file).
 * Accepts multipart/form-data with an 'image' field.
 *
 * Optional form fields:
 * - conflict_resolution: 'overwrite' | 'auto-rename' — how to handle filename conflicts
 *
 * HEIC/HEIF files are automatically converted to JPEG before saving.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (!usesImageRepoKind(paths.kind) || !paths.filesDir) {
			throw error(400, 'Upload only supported for file-backed media types');
		}
		const allowAnyMime = paths.kind === 'generic' || paths.kind === 'blob_store';
		const imagesDirPath = paths.filesDir;

		const formData = await request.formData();
		const imageFile = formData.get('image') as File;
		if (!imageFile) throw error(400, 'No file provided');

		if (!allowAnyMime && !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(imageFile.type)) {
			throw error(400, 'Invalid file type. Only JPEG, PNG, GIF, SVG, WebP, and HEIC images are allowed.');
		}
		if (!fs.existsSync(imagesDirPath)) {
			fs.mkdirSync(imagesDirPath, { recursive: true });
		}

		const conflictResolution = formData.get('conflict_resolution') as string | null;

		// Read file data
		const arrayBuffer = await imageFile.arrayBuffer();
		let buffer = Buffer.from(arrayBuffer);
		let safeFileName: string;

		// Convert HEIC/HEIF to JPEG (only if not generic)
		if (!allowAnyMime && (isHeicMime(imageFile.type) || isHeicExtension(imageFile.name))) {
			const converted = await convert({ buffer: buffer as unknown as ArrayBufferLike, format: 'JPEG', quality: 0.92 });
			buffer = Buffer.from(converted instanceof Uint8Array ? converted : new Uint8Array(converted));
			// Change extension to .jpg
			const baseName = path.basename(imageFile.name, path.extname(imageFile.name));
			safeFileName = assertSafeImageFilename(`${baseName}.jpg`);
		} else {
			// for generic types, we still use the filename assertion or fallback
			safeFileName = allowAnyMime
				? path.basename(imageFile.name).replace(/[^a-zA-Z0-9.\-_]/g, '_')
				: assertSafeImageFilename(imageFile.name);
		}

		const targetPath = path.join(imagesDirPath, safeFileName);

		// Handle filename conflicts
		if (fs.existsSync(targetPath)) {
			if (conflictResolution === 'overwrite') {
				// Overwrite: proceed with writing
			} else if (conflictResolution === 'auto-rename') {
				safeFileName = generateUniqueFilename(safeFileName, imagesDirPath);
			} else {
				// No resolution specified and file exists: return 409
				throw error(409, { message: `File "${safeFileName}" already exists` });
			}
		}

		const finalPath = path.join(imagesDirPath, safeFileName);
		fs.writeFileSync(finalPath, buffer);

		// Register the blob in the global manifest so it has a stable file_id, then return that id.
		// The file is not added to any catalog (it appears in the unlinked list); "Link to catalog"
		// creates a row under this same file_id.
		const fileId = await mintFileId(safeFileName, buffer.length);
		return json({
			success: true,
			id: fileId,
			file_id: fileId,
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
