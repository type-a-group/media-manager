import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renameBlobById } from '$lib/storage/classRepo.js';
import { ImageIdSchema } from '$lib/core/ids.js';
import { z } from 'zod';

const RenameBodySchema = z.object({ new_filename: z.string().min(1) });

/** POST: Rename a blob on disk + in the manifest (O(1); every class reference is unaffected). */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	const parsed = RenameBodySchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'new_filename is required');
	try {
		const filename = await renameBlobById(id.data, parsed.data.new_filename);
		return json({ success: true, filename });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			if ((err as { status?: number }).status === 409)
				throw error(409, 'Target filename already exists');
			throw err as never;
		}
		const e = err as Error;
		if (e.message?.includes('already exists')) throw error(409, e.message);
		if (e.message?.includes('not found')) throw error(404, e.message);
		if (e.message?.includes('Invalid filename')) throw error(400, e.message);
		throw error(500, { message: e.message ?? 'Rename failed' });
	}
};
