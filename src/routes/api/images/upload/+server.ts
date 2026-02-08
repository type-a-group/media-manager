import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { imageRepo } from '$lib/server/imageRepo.js';
import { ALLOWED_IMAGE_MIME_TYPES } from '$lib/core/images.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';

/**
 * POST handler for uploading image files
 * Accepts multipart/form-data with an 'image' field containing the file
 * Saves the file to the images directory with the original filename
 * 
 * #NOTE: Future concerns:
 * - File naming conflicts: Currently overwrites existing files with same name
 * - File size limits: No current limit imposed, could lead to storage issues
 * - Security: Limited file type validation, could be enhanced
 * - Storage management: No cleanup or organization by date/category
 * - Error handling: Could be more granular for different failure types
 */
export const POST: RequestHandler = async ({ request }) => {
	const imagesDirPath = imageRepo.paths.imagesDir;
	try {
		// Parse the multipart form data
		const formData = await request.formData();
		const imageFile = formData.get('image') as File;

		// Validate that a file was provided
		if (!imageFile) {
			throw error(400, 'No image file provided');
		}

		// Validate file type - only allow common image formats
		if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(imageFile.type)) {
			throw error(400, 'Invalid file type. Only JPEG, PNG, GIF, and SVG images are allowed.');
		}

		// #NOTE: File size validation could be added here
		// Example: if (imageFile.size > 10 * 1024 * 1024) throw error(400, 'File too large');

		// Ensure the images directory exists
		if (!fs.existsSync(imagesDirPath)) {
			fs.mkdirSync(imagesDirPath, { recursive: true });
		}

		// Validate and normalize the filename.
		// This also enforces an extension allowlist (matches our filesystem sync rules).
		const safeFileName = assertSafeImageFilename(imageFile.name);
		const targetPath = path.join(imagesDirPath, safeFileName);

		// #NOTE: Filename conflict handling - currently overwrites existing files
		// Future enhancement: Could add timestamp or hash to avoid conflicts
		// Example: const uniqueName = `${Date.now()}-${fileName}`;

		// Convert File to Buffer and write to disk
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
		console.error('Upload error:', err);
		
		// Handle known error types
		if (err && typeof err === 'object' && 'status' in err) {
			throw err; // Re-throw SvelteKit errors
		}

		// Return a structured error response.
		// Note: throwing `error(500, ...)` will be masked to "Internal Error" in prod builds,
		// which makes local CLI debugging painful.
		const e = err as any;
		return json(
			{
				message: e?.message ?? 'Upload failed',
				code: e?.code ?? null,
				imagesDir: imagesDirPath
			},
			{ status: 500 }
		);
	}
}; 