import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';

/**
 * Return runtime configuration values needed by the client UI.
 *
 * Use case:
 * - UI needs to display where images are being read/written.
 * - When running as a future CLI (`npx`), paths can be configured via env/flags.
 *
 * Concerns / future improvements:
 * - If we add more config, version the response to avoid breaking older clients.
 */
export const GET: RequestHandler = async () => {
	return json({
		imagesDir: imageRepo.paths.imagesDir,
		baseDir: imageRepo.paths.baseDir
	});
};

