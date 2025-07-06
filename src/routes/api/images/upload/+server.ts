import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Define the target directory for uploaded images
const imagesDirPath = 'src/lib/assets/images';

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
	try {
		// Parse the multipart form data
		const formData = await request.formData();
		const imageFile = formData.get('image') as File;

		// Validate that a file was provided
		if (!imageFile) {
			throw error(400, 'No image file provided');
		}

		// Validate file type - only allow common image formats
		const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg+xml'];
		if (!allowedTypes.includes(imageFile.type)) {
			throw error(400, 'Invalid file type. Only JPEG, PNG, GIF, and SVG images are allowed.');
		}

		// #NOTE: File size validation could be added here
		// Example: if (imageFile.size > 10 * 1024 * 1024) throw error(400, 'File too large');

		// Ensure the images directory exists
		if (!fs.existsSync(imagesDirPath)) {
			fs.mkdirSync(imagesDirPath, { recursive: true });
		}

		// Get the file extension and create target path
		const fileName = imageFile.name;
		const targetPath = path.join(imagesDirPath, fileName);

		// #NOTE: Filename conflict handling - currently overwrites existing files
		// Future enhancement: Could add timestamp or hash to avoid conflicts
		// Example: const uniqueName = `${Date.now()}-${fileName}`;

		// Convert File to Buffer and write to disk
		const arrayBuffer = await imageFile.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		
		fs.writeFileSync(targetPath, buffer);

		// Return success response with filename
		return json({ 
			success: true, 
			filename: fileName,
			message: 'Image uploaded successfully'
		});

	} catch (err) {
		console.error('Upload error:', err);
		
		// Handle known error types
		if (err && typeof err === 'object' && 'status' in err) {
			throw err; // Re-throw SvelteKit errors
		}
		
		// Handle unexpected errors
		throw error(500, 'Failed to upload image');
	}
}; 