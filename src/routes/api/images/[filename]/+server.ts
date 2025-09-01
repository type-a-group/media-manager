import { error, type RequestHandler, json } from '@sveltejs/kit';
import * as fs from 'node:fs';
import * as path from 'node:path';

const imagesDirPath = 'src/lib/assets/images';
const imageDataPath = 'src/lib/assets/image-data.json';

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

export const DELETE: RequestHandler = async ({ params }) => {
    const { filename } = params;
    if (!filename) {
        throw error(400, 'Filename is required');
    }

    try {
        // Only unlink: remove properties entry from image-data.json if present
        if (fs.existsSync(imageDataPath)) {
            const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
            const allData = JSON.parse(jsonData);
            const imagesArray = Array.isArray(allData.images) ? allData.images : [];

            const filtered = imagesArray.filter((img: { file_name: string }) => img.file_name !== filename);
            if (filtered.length !== imagesArray.length) {
                allData.images = filtered;
                fs.writeFileSync(imageDataPath, JSON.stringify(allData, null, 2));
            }
        }

        return json({ success: true, unlinked: true });
    } catch (err) {
        console.error(err);
        throw error(500, 'Failed to unlink image');
    }
};