import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listMediaTypes,
	createMediaType,
	ensureGlobalsGroupExists
} from '$lib/storage/mediaTypes.js';
import { z } from 'zod';

const CreateBodySchema = z.object({
	displayName: z.string().min(1).max(256)
});

/**
 * GET: List all top-level (`json`) media types (scan root for valid folders).
 * Returns [{ id, displayName, kind }]. File-backed catalogs are now classes (see `/api/classes`).
 */
export const GET: RequestHandler = async () => {
	try {
		await ensureGlobalsGroupExists();
		return json(listMediaTypes());
	} catch (err) {
		console.error('List media types error:', err);
		throw error(500, { message: 'Failed to list media types' });
	}
};

/**
 * POST: Create a new `json` media type. Body: { displayName }.
 * Creates folder + settings.json + empty data file.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const parsed = CreateBodySchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid body: displayName required');
	try {
		const typeId = await createMediaType(parsed.data.displayName);
		const created = listMediaTypes().find((m) => m.id === typeId);
		return json(created ?? { id: typeId, displayName: parsed.data.displayName, kind: 'json' });
	} catch (err) {
		const e = err as Error;
		console.error('Create media type error:', e);
		throw error(500, { message: e.message ?? 'Failed to create media type' });
	}
};
