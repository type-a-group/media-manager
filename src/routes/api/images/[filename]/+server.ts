import { error, type RequestHandler, json } from '@sveltejs/kit';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { imageRepo } from '$lib/server/imageRepo.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';

export const GET: RequestHandler = ({ params }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}
	const safe = assertSafeImageFilename(filename);
	const filePath = path.join(imageRepo.paths.imagesDir, safe);

	try {
		if (fs.existsSync(filePath)) {
			const imageBuffer = fs.readFileSync(filePath);
			const fileExtension = path.extname(safe).toLowerCase();
			let contentType = 'application/octet-stream'; // Default content type

			switch (fileExtension) {
				case '.jpg':
				case '.jpeg':
					contentType = 'image/jpeg';
					break;
				case '.png':
					contentType = 'image/png';
					break;
				case '.gif':
					contentType = 'image/gif';
					break;
				case '.svg':
					contentType = 'image/svg+xml';
					break;
			}

			return new Response(imageBuffer, {
				headers: {
					'Content-Type': contentType
				}
			});
		} else {
			throw error(404, 'Image not found');
		}
	} catch {
		throw error(500, 'Server error');
	}
}; 

export const DELETE: RequestHandler = async ({ params }) => {
    const { filename } = params;
    if (!filename) {
        throw error(400, 'Filename is required');
    }

    try {
		const safe = assertSafeImageFilename(filename);
		const rec = await imageRepo.getRecordByFilename(safe);
		if (rec) {
			await imageRepo.unlinkById(rec.id);
		}

        return json({ success: true, unlinked: true });
    } catch {
        throw error(500, 'Failed to unlink image');
    }
};