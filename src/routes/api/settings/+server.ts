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
	autoSaveOnAdvance: z.boolean().optional(),
	railCollapsed: z.boolean().optional(),
	// All Files hub list sort (Item 9). Empty string clears the override (default sort).
	sortField: z.string().max(256).optional(),
	sortDir: z.enum(['asc', 'desc']).optional()
});

/** GET: current global settings. */
export const GET: RequestHandler = async () => {
	const s = readMediaSettings();
	return json({
		gridSize: s.gridSize,
		autoAdvanceToNextUnlinked: s.autoAdvanceToNextUnlinked,
		autoSaveOnAdvance: s.autoSaveOnAdvance,
		railCollapsed: s.railCollapsed,
		sortField: s.sortField ?? '',
		sortDir: s.sortDir ?? ''
	});
};

/** POST: merge a partial update and persist. */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const parsed = PatchSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid settings payload');
	// Empty `sortField` clears the override (back to default); coerce to undefined so it isn't persisted.
	const patch = { ...parsed.data };
	if (patch.sortField === '') patch.sortField = undefined;
	const updated = await writeMediaSettings(patch);
	return json({
		gridSize: updated.gridSize,
		autoAdvanceToNextUnlinked: updated.autoAdvanceToNextUnlinked,
		autoSaveOnAdvance: updated.autoSaveOnAdvance,
		railCollapsed: updated.railCollapsed,
		sortField: updated.sortField ?? '',
		sortDir: updated.sortDir ?? ''
	});
};
