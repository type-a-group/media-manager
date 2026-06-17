import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * The per-type record route was replaced by the Records Explorer at `/media`, which selects the
 * active type via the `?type=` query param (in-page selection; deep per-record routing is deferred —
 * see `docs/FUTURE_CHANGES.md` Item 20). This keeps old links/bookmarks like `/media/notes` working
 * by redirecting into the Explorer with that type preselected.
 */
export const load: PageLoad = ({ params }) => {
	throw redirect(307, `/media?type=${encodeURIComponent(params.typeId)}`);
};
