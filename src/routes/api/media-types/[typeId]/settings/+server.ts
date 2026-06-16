import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import {
	readMediaTypeSettingsFileSync,
	writeMediaTypeSettingsFile
} from '$lib/storage/settingsFile.js';
import { z } from 'zod';

const SettingsPatchSchema = z.object({
	displayName: z.string().min(1).max(256).optional(),
	gridSize: z.enum(['small', 'medium', 'large']).optional()
});

/** GET: Current settings for this `json` media type. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		getMediaTypeRepo(typeId); // validate
		const paths = getMediaTypePaths(typeId);
		const settings = readMediaTypeSettingsFileSync(paths.baseDir);
		if (!settings) throw error(404, 'Media type not found');
		return json({
			displayName: settings.displayName,
			kind: settings.kind,
			dataFileName: settings.dataFileName,
			gridSize: settings.gridSize ?? 'medium'
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to read settings' });
	}
};

/** POST: Update settings (merge partial). */
export const POST: RequestHandler = async ({ params, request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		throw error(400, 'Content-Type must be application/json');
	}
	const parsed = SettingsPatchSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid settings payload');
	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const paths = getMediaTypePaths(typeId);
		const schema = await repo.getSchema();
		const current = readMediaTypeSettingsFileSync(paths.baseDir);
		if (!current) throw error(404, 'Media type not found');
		const patch: Record<string, unknown> = { kind: paths.kind, schema };
		if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
		if (parsed.data.gridSize !== undefined) patch.gridSize = parsed.data.gridSize;
		const updated = await writeMediaTypeSettingsFile(paths.baseDir, patch as never);
		return json({
			displayName: updated.displayName,
			kind: updated.kind,
			gridSize: updated.gridSize ?? 'medium'
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to update settings' });
	}
};
