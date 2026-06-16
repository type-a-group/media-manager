import { error, type RequestHandler, json } from '@sveltejs/kit';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { imageRepo } from '$lib/server/imageRepo.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';
import { contentTypeForFile } from '$lib/server/contentType.js';

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
			return new Response(imageBuffer, {
				headers: {
					'Content-Type': contentTypeForFile(safe)
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