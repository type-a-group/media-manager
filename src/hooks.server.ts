import type { Handle } from '@sveltejs/kit';
import { assertCurrentLayout } from '$lib/storage/layoutGuard.js';

/**
 * Server hooks.
 *
 * **Old-layout guard (Item 18).** The app reads only the current data-root layout — there is no
 * dual-read of the pre-Item-18 (flat) layout. Rather than silently serve a broken/empty workspace,
 * the first request runs a one-shot, read-only layout check; if the root is un-migrated, every
 * request fails loudly with a "run upgrade-data" message until it's fixed. The check is memoized so
 * the filesystem scan happens once per process (the layout can't change mid-run).
 */
let layoutChecked = false;
let layoutError: Error | null = null;

export const handle: Handle = async ({ event, resolve }) => {
	if (!layoutChecked) {
		layoutChecked = true;
		try {
			assertCurrentLayout();
		} catch (err) {
			layoutError = err as Error;
		}
	}
	if (layoutError) {
		return new Response(layoutError.message, {
			status: 500,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}
	return resolve(event);
};
