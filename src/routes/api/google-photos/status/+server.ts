import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStatus } from '$lib/server/googlePhotos.js';

/** GET: connection status for the Google Photos dialog/badge ({ hasCreds, connected, expiresInDays, … }). */
export const GET: RequestHandler = async () => {
	return json(await getStatus());
};
