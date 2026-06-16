import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';
import path from 'node:path';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { contentTypeForFile } from '$lib/server/contentType.js';

/**
 * GET: Return raw image file bytes by record id (images kind only).
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images' || !paths.filesDir) throw error(400, 'Not an images media type');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/repo.js').ImageRepo;
		const filename = await repo.getFilenameForId(id.data);
		if (!filename) throw error(404, 'Image not found');
		const filePath = path.join(paths.filesDir, filename);
		if (!fs.existsSync(filePath)) throw error(404, 'Image file not found');
		const imageBuffer = fs.readFileSync(filePath);
		return new Response(imageBuffer, {
			headers: { 'Content-Type': contentTypeForFile(filename) }
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to get image' });
	}
};

/**
 * DELETE: Delete the image file from disk and remove its record (images kind only).
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');

	try {
		const typeId = params.typeId;
		const paths = getMediaTypePaths(typeId);
		if (paths.kind !== 'images') throw error(400, 'Not an images media type');
		const repo = getMediaTypeRepo(typeId) as import('$lib/storage/repo.js').ImageRepo;
		await repo.deleteFromDiskById(id.data);
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const msg = (e as Error)?.message;
		if (msg?.includes('not found')) throw error(404, msg);
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to delete image' });
	}
};
