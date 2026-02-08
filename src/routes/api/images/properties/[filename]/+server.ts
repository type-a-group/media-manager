import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import { assertSafeImageFilename } from '$lib/storage/filenames.js';
import { UpdatePropertiesRequestSchema } from '$lib/core/types.js';

export const GET: RequestHandler = ({ params }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}
	const safe = assertSafeImageFilename(filename);

	return imageRepo
		.ensureRecordForFilename(safe)
		.then((rec) => json(rec))
		.catch(() => {
			throw error(500, { message: 'Failed to read image properties' });
		});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { filename } = params;
	if (!filename) {
		throw error(400, 'Filename is required');
	}

	try {
		const safe = assertSafeImageFilename(filename);
		const rec = await imageRepo.ensureRecordForFilename(safe);
		const body = await request.json();
		const patch = UpdatePropertiesRequestSchema.safeParse(body);
		if (!patch.success) throw error(400, 'Invalid properties payload');

		const updated = await imageRepo.updatePropertiesById(rec.id, patch.data);
		return json({ success: true, properties: updated });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as any;
		throw error(500, { message: 'Failed to save image properties' });
	}
}; 