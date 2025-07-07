import { json } from '@sveltejs/kit';
import * as fs from 'node:fs';

// Assuming image-data.json is at src/lib/assets/image-data.json
const imageDataPath = 'src/lib/assets/image-data.json';
const imagesDirPath = 'src/lib/assets/images';

export async function GET({ url }) {
	const query = url.searchParams.get('query');
	const field = url.searchParams.get('field');
	const empty = url.searchParams.get('empty') === 'true';
	try {
		// Read images from the filesystem
		const fsImages = fs
			.readdirSync(imagesDirPath)
			.filter((file) => /\.(jpg|jpeg|png|gif|svg)$/i.test(file));

		// Read images from the JSON file
		const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
		const allData = JSON.parse(jsonData);
		const jsonImagesData = allData.images;
		const jsonImages = jsonImagesData
			.filter((img: { file_name: string }) => img.file_name && img.file_name !== '')
			.map((img: { file_name: string }) => img.file_name);

		let inBoth = fsImages.filter((file) => jsonImages.includes(file));
		const inAssetsOnly = fsImages.filter((file) => !jsonImages.includes(file));
		const inJsonOnly = jsonImages.filter((file: string) => !fsImages.includes(file));

		// Apply filters only if we have a query or empty filter
		if (query || empty) {
			const imagePropertiesMap: Map<string, { [key: string]: any }> = new Map(
				jsonImagesData.map((img: any) => [img.file_name, img])
			);

			inBoth = inBoth.filter((file) => {
				const properties = imagePropertiesMap.get(file);
				if (!properties) {
					return false; // Should not happen for inBoth list
				}
				
				// Filter for empty values
				if (empty) {
					if (!field) return false;
					return properties[field] === '' || properties[field] === undefined || properties[field] === null;
				}
				
				// Filter by search query
				if (query && field && properties[field] !== undefined) {
					return String(properties[field]).toLowerCase().includes(query.toLowerCase());
				}
				
				// If we have a query but no field, or field doesn't exist, exclude
				return false;
			});
		}
		// If no filters are applied, return all images without filtering

		return json({
			inBoth,
			inAssetsOnly,
			inJsonOnly
		});
	} catch (error) {
		console.error(error);
		return json({ error: 'Failed to compare images' }, { status: 500 });
	}
} 