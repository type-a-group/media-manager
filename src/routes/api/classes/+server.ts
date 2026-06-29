import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { listClasses, createClass } from '$lib/storage/classRepo.js';
import { SchemaDefinitionSchema } from '$lib/core/types.js';

const CreateBodySchema = z.object({
	displayName: z.string().min(1).max(256),
	schema: SchemaDefinitionSchema.optional()
});

/** GET: List every class with display name and member count. */
export const GET: RequestHandler = async () => {
	try {
		return json(listClasses());
	} catch (err) {
		console.error('List classes error:', err);
		throw error(500, { message: 'Failed to list classes' });
	}
};

/** POST: Create a new class (empty schema = pure-tag class). Body: { displayName, schema? }. */
export const POST: RequestHandler = async ({ request }) => {
	const parsed = CreateBodySchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'displayName is required');
	try {
		const id = await createClass(parsed.data.displayName, parsed.data.schema ?? {});
		const created = listClasses().find((c) => c.id === id);
		return json(created ?? { id, displayName: parsed.data.displayName, count: 0 });
	} catch (err) {
		const e = err as Error;
		console.error('Create class error:', e);
		throw error(500, { message: e.message ?? 'Failed to create class' });
	}
};
