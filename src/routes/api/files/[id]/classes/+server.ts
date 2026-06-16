import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ImageIdSchema } from '$lib/core/ids.js';
import { listClassesReferencingFileId, readClassFile, getRecord } from '$lib/storage/classRepo.js';

/**
 * GET: Every class this blob belongs to, with that class's schema, config, and the blob's record —
 * the data the per-file editor renders as one collapsible section per class. Also serves as the
 * "usage" surface for delete-from-disk confirmations.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = ImageIdSchema.safeParse(params.id);
	if (!id.success) throw error(400, 'Invalid id');
	try {
		const memberships = listClassesReferencingFileId(id.data);
		const classes = await Promise.all(
			memberships.map(async ({ id: classId, displayName }) => {
				const file = await readClassFile(classId);
				const record = await getRecord(classId, id.data);
				return { id: classId, displayName, schema: file.schema, config: file.config, record };
			})
		);
		return json({ classes });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		throw error(500, { message: 'Failed to load file classes' });
	}
};
