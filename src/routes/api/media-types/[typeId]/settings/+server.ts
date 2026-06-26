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
	// The "title by" field for the Records Explorer list. Empty string clears it (back to default).
	displayField: z.string().max(256).optional(),
	// The optional "subtitle by" field. Empty string clears it (no subtitle line).
	subtitleField: z.string().max(256).optional(),
	// The list sort key (Item 9): a built-in or schema field key. Empty string clears it (default sort).
	sortField: z.string().max(256).optional(),
	// The list sort direction.
	sortDir: z.enum(['asc', 'desc']).optional(),
	// Per-type icon id (a curated Lucide id). Empty string clears it (back to the generic fallback).
	icon: z.string().max(64).optional()
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
			displayField: settings.displayField ?? '',
			subtitleField: settings.subtitleField ?? '',
			sortField: settings.sortField ?? '',
			sortDir: settings.sortDir ?? '',
			icon: settings.icon ?? ''
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
		// Empty string clears the title-by override; any other value persists it.
		if (parsed.data.displayField !== undefined)
			patch.displayField = parsed.data.displayField || undefined;
		// Empty string clears the subtitle field; any other value persists it.
		if (parsed.data.subtitleField !== undefined)
			patch.subtitleField = parsed.data.subtitleField || undefined;
		// Empty string clears the sort override (back to default); any other value persists it.
		if (parsed.data.sortField !== undefined) patch.sortField = parsed.data.sortField || undefined;
		if (parsed.data.sortDir !== undefined) patch.sortDir = parsed.data.sortDir;
		// Empty string clears the icon (back to the generic fallback); any other value persists it.
		if (parsed.data.icon !== undefined) patch.icon = parsed.data.icon || undefined;
		const updated = await writeMediaTypeSettingsFile(paths.baseDir, patch as never);
		return json({
			displayName: updated.displayName,
			kind: updated.kind,
			displayField: updated.displayField ?? '',
			subtitleField: updated.subtitleField ?? '',
			sortField: updated.sortField ?? '',
			sortDir: updated.sortDir ?? '',
			icon: updated.icon ?? ''
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
