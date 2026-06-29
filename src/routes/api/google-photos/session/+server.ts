import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAccessToken, createSession } from '$lib/server/googlePhotos.js';

/**
 * POST: create a Picker session. Returns the `sessionId` plus the `pickerUri` for the client to open
 * in a new tab (Google's hosted picker can't be embedded), and the polling cadence Google suggests.
 */
export const POST: RequestHandler = async () => {
	try {
		const accessToken = await getAccessToken();
		const session = await createSession(accessToken);
		return json({
			sessionId: session.id,
			pickerUri: session.pickerUri,
			pollIntervalMs: pollMs(session.pollingConfig?.pollInterval)
		});
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};

/** Parse Google's duration string (e.g. "2.5s") into milliseconds; default 3s. */
function pollMs(interval: string | undefined): number {
	if (!interval) return 3000;
	const secs = parseFloat(interval.replace(/s$/, ''));
	return Number.isFinite(secs) ? Math.max(1000, Math.round(secs * 1000)) : 3000;
}
