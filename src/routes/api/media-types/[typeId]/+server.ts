import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { deleteMediaType } from '$lib/storage/mediaTypes.js';
import { purgeTypeLinks } from '$lib/storage/relationLinks.js';
import {
	readMediaTypeSettingsFileSync,
	writeMediaTypeSettingsFile
} from '$lib/storage/settingsFile.js';
import { z } from 'zod';

const RenameBodySchema = z.object({
	displayName: z.string().min(1).max(256)
});

/**
 * GET: Return media type summary (id, displayName, kind) and paths/config for the UI.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		const settings = readMediaTypeSettingsFileSync(paths.baseDir);
		const displayName = settings?.displayName ?? typeId;
		return json({
			id: typeId,
			displayName,
			kind: paths.kind,
			baseDir: paths.baseDir
		});
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to get media type' });
	}
};

/**
 * PATCH: Rename (update displayName only in settings.json).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const body = await request.json();
	const parsed = RenameBodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, 'Invalid body: displayName required');
	}
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Globals group cannot be renamed');
		const repo = getMediaTypeRepo(typeId); // validate typeId and that folder exists
		const paths = getMediaTypePaths(typeId);
		const schema = await repo.getSchema();
		await writeMediaTypeSettingsFile(paths.baseDir, {
			displayName: parsed.data.displayName,
			kind: paths.kind,
			schema
		});
		return json({ displayName: parsed.data.displayName });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to rename media type' });
	}
};

/**
 * DELETE: Delete the media type folder and all contents (confirm on client).
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') throw error(403, 'Globals group cannot be deleted');
		getMediaTypeRepo(typeId); // validate typeId and that folder exists
		// Clear the link declaration on any class record field that targeted this type.
		await purgeTypeLinks(typeId);
		await deleteMediaType(typeId);
		return json({ success: true });
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a media type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to delete media type' });
	}
};
