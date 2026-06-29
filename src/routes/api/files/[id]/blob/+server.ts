import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';
import path from 'node:path';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';

const CONTENT_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.pdf': 'application/pdf',
	'.txt': 'text/plain; charset=utf-8'
};

/** GET: Raw blob bytes by manifest id. */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	try {
		const filename = await getFilenameForId(id.data);
		if (!filename) throw error(404, 'File not found');
		const filePath = path.join(getGlobalFilesDir(), filename);
		if (!fs.existsSync(filePath)) throw error(404, 'File not found on disk');
		const buffer = fs.readFileSync(filePath);
		const ext = path.extname(filename).toLowerCase();
		return new Response(buffer, {
			headers: { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' }
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		throw error(500, { message: 'Failed to get file' });
	}
};
