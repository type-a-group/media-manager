import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { getFilenameForId } from '$lib/storage/classRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { readImageFileMetadata, stripImageFileMetadata } from '$lib/server/fileMetadata.js';
import { z } from 'zod';

const StripBodySchema = z.object({ mode: z.enum(['all', 'gps']) });

/** POST: Strip EXIF metadata from a blob (`all` or `gps`-only). Returns the updated metadata. */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const parsed = StripBodySchema.safeParse(body);
	if (!parsed.success) throw error(400, 'Body must be { mode: "all" | "gps" }');
	try {
		const filename = await getFilenameForId(id.data);
		if (!filename) throw error(404, 'File not found');
		const dir = getGlobalFilesDir();
		await stripImageFileMetadata(dir, filename, {
			all: parsed.data.mode === 'all',
			gpsOnly: parsed.data.mode === 'gps'
		});
		return json(await readImageFileMetadata(dir, filename));
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const cause = (e as { cause?: unknown }).cause;
		throw error(500, (cause ? `${e.message}: ${cause}` : e.message) || 'Failed to strip metadata');
	}
};
