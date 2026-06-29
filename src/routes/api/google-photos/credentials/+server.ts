import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateGoogleConfig } from '$lib/storage/googleConfig.js';

/**
 * POST: save the user's bring-your-own OAuth Client ID + secret into `media/google.json` (0600).
 *
 * Changing the Client ID invalidates any stored refresh token, so the connection is cleared to force a
 * fresh consent.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		clientId?: string;
		clientSecret?: string;
	};
	const clientId = body.clientId?.trim();
	const clientSecret = body.clientSecret?.trim();
	if (!clientId || !clientSecret) throw error(400, 'Both clientId and clientSecret are required.');

	await updateGoogleConfig((cur) => {
		const clientChanged = cur.clientId !== clientId;
		return {
			...cur,
			clientId,
			clientSecret,
			...(clientChanged ? { refreshToken: undefined, tokenObtainedAt: undefined } : {})
		};
	});
	return json({ success: true });
};
