import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import { readSettingsFileSync, writeSettingsFile } from '$lib/storage/settingsFile.js';
import { z } from 'zod';

const SettingsPatchSchema = z.object({
	autoAdvanceToNextUnlinked: z.boolean().optional(),
	autoSaveOnAdvance: z.boolean().optional(),
	gridSize: z.enum(['small', 'medium', 'large']).optional()
});

/**
 * GET: Return current settings from settings.json.
 */
export const GET: RequestHandler = async () => {
	const baseDir = imageRepo.paths.baseDir;
	const settings = readSettingsFileSync(baseDir);
	return json(settings);
};

/**
 * POST: Update settings in settings.json.
 * Accepts partial settings; merges with existing.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const body = await request.json();
	const parsed = SettingsPatchSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, 'Invalid settings payload');
	}
	const baseDir = imageRepo.paths.baseDir;
	const updated = await writeSettingsFile(baseDir, parsed.data);
	return json(updated);
};
