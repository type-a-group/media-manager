import { json } from '@sveltejs/kit';
import * as fs from 'node:fs';

export async function GET() {
	const imageDir = 'src/lib/assets/images';
	try {
		const files = fs.readdirSync(imageDir);
		const imageFiles = files.filter((file: string) =>
			/\.(jpg|jpeg|png|gif|svg)$/i.test(file)
		);
		return json(imageFiles);
	} catch (error) {
		return json({ error: 'Unable to read image directory' }, { status: 500 });
	}
} 