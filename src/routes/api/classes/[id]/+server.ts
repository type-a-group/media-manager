import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { readClassFile, updateClassConfig, deleteClass } from '$lib/storage/classRepo.js';

const ConfigPatchSchema = z.object({
	displayName: z.string().min(1).max(256).optional(),
	gridGroupByField: z.string().optional(),
	displayField: z.string().optional(),
	gridSize: z.enum(['small', 'medium', 'large']).optional()
});

/** GET: A class's schema + config (the editor/grid bootstrap). */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const file = await readClassFile(params.id);
		return json({ id: params.id, schema: file.schema, config: file.config });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to load class' });
	}
};

/** PATCH: Update a class's config (rename displayName, grid prefs). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const parsed = ConfigPatchSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid config payload');
	try {
		const config = await updateClassConfig(params.id, parsed.data);
		return json({ success: true, config });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('not found')) throw error(404, 'Class not found');
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to update class' });
	}
};

/** DELETE: Remove a class (destroys its metadata; blobs are untouched). */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteClass(params.id);
		return json({ success: true });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid class id')) throw error(400, e.message);
		throw error(500, { message: 'Failed to delete class' });
	}
};
