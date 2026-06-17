import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { readMediaSettings, writeMediaSettings } from '$lib/storage/mediaSettings.js';

/**
 * Global app settings, backed by `media/settings.json`.
 *
 * These are the app-wide UI preferences (grid size + navigation behavior) shared by every view.
 * Replaces the removed `/api/config/settings` endpoint and the per-class / per-`json`-type
 * grid-size overrides.
 */

const PatchSchema = z.object({
	gridSize: z.enum(['small', 'medium', 'large']).optional(),
	autoAdvanceToNextUnlinked: z.boolean().optional(),
	autoSaveOnAdvance: z.boolean().optional()
});

/** GET: current global settings. */
export const GET: RequestHandler = async () => {
	const s = readMediaSettings();
	return json({
		gridSize: s.gridSize,
		autoAdvanceToNextUnlinked: s.autoAdvanceToNextUnlinked,
		autoSaveOnAdvance: s.autoSaveOnAdvance
	});
};

/** POST: merge a partial update and persist. */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const parsed = PatchSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid settings payload');
	const updated = await writeMediaSettings(parsed.data);
	return json({
		gridSize: updated.gridSize,
		autoAdvanceToNextUnlinked: updated.autoAdvanceToNextUnlinked,
		autoSaveOnAdvance: updated.autoSaveOnAdvance
	});
};
