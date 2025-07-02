import { error, type RequestHandler } from '@sveltejs/kit';
import * as fs from 'node:fs';
import * as path from 'node:path';

const imagesDirPath = 'src/lib/assets/images';

export const GET: RequestHandler = ({ params }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}
	const filePath = path.join(imagesDirPath, filename);

	try {
		if (fs.existsSync(filePath)) {
			const imageBuffer = fs.readFileSync(filePath);
			const fileExtension = path.extname(filename).toLowerCase();
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
	} catch (err) {
		console.error(err);
		throw error(500, 'Server error');
	}
}; 