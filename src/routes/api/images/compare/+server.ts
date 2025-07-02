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
			.filter((img: { image_name: string }) => img.image_name && img.image_name !== '')
			.map((img: { image_name: string }) => img.image_name);

		let inBoth = fsImages.filter((file) => jsonImages.includes(file));
		const inAssetsOnly = fsImages.filter((file) => !jsonImages.includes(file));
		const inJsonOnly = jsonImages.filter((file: string) => !fsImages.includes(file));

		if (query || empty) {
			const imageMetadataMap: Map<string, { [key: string]: any }> = new Map(
				jsonImagesData.map((img: any) => [img.image_name, img])
			);

			inBoth = inBoth.filter((file) => {
				const metadata = imageMetadataMap.get(file);
				if (!metadata) {
					return false; // Should not happen for inBoth list
				}
				if (empty) {
					if (!field) return false;
					return metadata[field] === '';
				}
				if (query && field && metadata[field] !== undefined) {
					return String(metadata[field]).toLowerCase().includes(query.toLowerCase());
				}
				return false;
			});
		}

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