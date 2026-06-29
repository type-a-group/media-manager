import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startLoopbackAuth } from '$lib/server/googlePhotos.js';

/**
 * POST: begin the OAuth flow. Spins a throwaway `http://127.0.0.1:<port>` loopback listener (Google's
 * Desktop-client redirect form, decoupled from however the app is served) and returns the consent
 * `authUrl` for the client to open in a new tab.
 */
export const POST: RequestHandler = async () => {
	try {
		const { authUrl } = await startLoopbackAuth();
		return json({ authUrl });
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};
