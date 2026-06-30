import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { previewLinkData } from '$lib/storage/relationLinks.js';

/**
 * GET: Preview the data mismatch a proposed two-way link would have, **without mutating anything**.
 * The schema editor calls this before declaring a link so it can prompt the user to reconcile only
 * when the class `record` field and the type `file` field already hold conflicting data.
 *
 * Query: `recordField` (the class record field key), `recordType` (its target json type), `fileField`
 * (the counterpart file field on that type). Returns `{ classOnly, typeOnly, mismatch }`.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const recordField = url.searchParams.get('recordField');
	const recordType = url.searchParams.get('recordType');
	const fileField = url.searchParams.get('fileField');
	if (!recordField || !recordType || !fileField)
		throw error(400, 'recordField, recordType, and fileField are required');
	try {
		const { classOnly, typeOnly } = await previewLinkData(
			params.id,
			recordField,
			recordType,
			fileField
		);
		return json({ classOnly, typeOnly, mismatch: classOnly > 0 || typeOnly > 0 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		throw error(500, { message: 'Failed to preview link' });
	}
};
