import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';
import path from 'node:path';

import { imageRepo } from '$lib/server/imageRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';

/**
 * GET: return raw image bytes by `imageId`.
 * DELETE: unlink/reset properties by `imageId` (keeps file on disk).
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	const filename = await imageRepo.getFilenameForId(id.data);
	if (!filename) throw error(404, 'Image not found');

	const filePath = path.join(imageRepo.paths.imagesDir, filename);
	if (!fs.existsSync(filePath)) throw error(404, 'Image file not found');

	const imageBuffer = fs.readFileSync(filePath);
	const ext = path.extname(filename).toLowerCase();
	const contentType =
		ext === '.jpg' || ext === '.jpeg'
			? 'image/jpeg'
			: ext === '.png'
				? 'image/png'
				: ext === '.gif'
					? 'image/gif'
					: ext === '.svg'
						? 'image/svg+xml'
						: 'application/octet-stream';

	return new Response(imageBuffer, { headers: { 'Content-Type': contentType } });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid imageId');

	await imageRepo.unlinkById(id.data);
	return json({ success: true });
};

