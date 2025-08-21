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

		const imageProperties = jsonImagesData.find(
			(img: { file_name: string }) => img.file_name === filename
		);

		if (imageProperties) {
			return json(imageProperties);
		} else {
			// Return a default object if not found, as per user story
			const defaultData = jsonImagesData.find((img: { default: boolean }) => img.default === true);
			if (defaultData) {
				return json({ ...defaultData, file_name: filename, default: false });
			}
			throw error(404, { message: 'Image properties not found and no default available' });
		}
	} catch (err) {
		console.error(err);
		throw error(500, { message: 'Failed to read or parse image properties' });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}

	try {
		const newProperties = await request.json();
		console.log('[properties POST] filename:', filename, 'incoming:', newProperties);
		const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
		const allData = JSON.parse(jsonData);
		const jsonImagesData = allData.images;

		// Add current timestamp to properties
		const propertiesWithTimestamp = { 
			...newProperties, 
			last_modified: new Date().toISOString() 
		};

		const imageIndex = jsonImagesData.findIndex(
			(img: { file_name: string }) => img.file_name === filename
		);

		if (imageIndex > -1) {
			// Update existing properties
			jsonImagesData[imageIndex] = { ...jsonImagesData[imageIndex], ...propertiesWithTimestamp };
			console.log('[properties POST] updated index', imageIndex, '->', jsonImagesData[imageIndex]);
		} else {
			// Add new properties (ensure file_name and default flag are set)
			const created = {
				file_name: filename,
				default: false,
				...propertiesWithTimestamp
			};
			jsonImagesData.push(created);
			console.log('[properties POST] created new entry ->', created);
		}

		allData.images = jsonImagesData;
		fs.writeFileSync(imageDataPath, JSON.stringify(allData, null, 2));
		console.log('[properties POST] wrote file');

		return json({ success: true, properties: jsonImagesData.find((img: { file_name: string }) => img.file_name === filename) });
	} catch (err) {
		console.error(err);
		throw error(500, { message: 'Failed to save image properties' });
	}
}; 