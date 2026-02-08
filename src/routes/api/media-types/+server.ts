import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMediaTypes, createMediaType } from '$lib/storage/mediaTypes.js';
import { z } from 'zod';

const CreateBodySchema = z.object({
	displayName: z.string().min(1).max(256),
	kind: z.enum(['images', 'json'])
});

/**
 * GET: List all media types (scan root for valid folders).
 * Returns [{ id, displayName, kind }].
 */
export const GET: RequestHandler = async () => {
	try {
		const list = listMediaTypes();
		return json(list);
	} catch (err) {
		console.error('List media types error:', err);
		throw error(500, { message: 'Failed to list media types' });
	}
};

/**
 * POST: Create a new media type.
 * Body: { displayName, kind: 'images' | 'json' }.
 * Creates folder + settings.json + empty data file; for images also creates files subdir.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const body = await request.json();
	const parsed = CreateBodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, 'Invalid body: displayName and kind required');
	}
	try {
		const typeId = await createMediaType(parsed.data.displayName, parsed.data.kind);
		const list = listMediaTypes();
		const created = list.find((m) => m.id === typeId);
		return json(created ?? { id: typeId, displayName: parsed.data.displayName, kind: parsed.data.kind });
	} catch (err) {
		const e = err as Error;
		console.error('Create media type error:', e);
		throw error(500, { message: e.message ?? 'Failed to create media type' });
	}
};
