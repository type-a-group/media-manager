import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';

const imageDataPath = 'src/lib/assets/image-data.json';

export const GET: RequestHandler = ({ params }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}

	try {
		const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
		const allData = JSON.parse(jsonData);
		const jsonImagesData = allData.images;

		const imageMetadata = jsonImagesData.find(
			(img: { file_name: string }) => img.file_name === filename
		);

		if (imageMetadata) {
			return json(imageMetadata);
		} else {
			// Return a default object if not found, as per user story
			const defaultData = jsonImagesData.find((img: { default: boolean }) => img.default === true);
			if (defaultData) {
				return json({ ...defaultData, file_name: filename, default: false });
			}
			throw error(404, { message: 'Image metadata not found and no default available' });
		}
	} catch (err) {
		console.error(err);
		throw error(500, { message: 'Failed to read or parse image metadata' });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}

	try {
		const newMetadata = await request.json();
		const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
		const allData = JSON.parse(jsonData);
		const jsonImagesData = allData.images;

		// Add current timestamp to metadata
		const metadataWithTimestamp = { 
			...newMetadata, 
			last_modified: new Date().toISOString() 
		};

		const imageIndex = jsonImagesData.findIndex(
			(img: { file_name: string }) => img.file_name === filename
		);

		if (imageIndex > -1) {
			// Update existing metadata
			jsonImagesData[imageIndex] = { ...jsonImagesData[imageIndex], ...metadataWithTimestamp };
		} else {
			// Add new metadata
			jsonImagesData.push(metadataWithTimestamp);
		}

		allData.images = jsonImagesData;
		fs.writeFileSync(imageDataPath, JSON.stringify(allData, null, 2));

		return json({ success: true, metadata: metadataWithTimestamp });
	} catch (err) {
		console.error(err);
		throw error(500, { message: 'Failed to save image metadata' });
	}
}; 