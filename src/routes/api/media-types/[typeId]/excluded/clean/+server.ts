import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from '$lib/storage/settingsFile.js';
import { z } from 'zod';

// Removes stale excluded entries by file_id (the blob's manifest identity).
const RequestSchema = z.object({
    file_ids: z.array(z.string()).min(1)
});

export const POST: RequestHandler = async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
        throw error(400, 'Invalid request body. Expected { file_ids: string[] }');
    }

    try {
        const typeId = params.typeId;
        const paths = getMediaTypePaths(typeId);
        const settings = readMediaTypeSettingsFileSync(paths.baseDir);
        if (!settings) throw error(404, 'Media type settings not found');

        const currentExcluded = settings.excludedFiles ?? [];
        const toRemove = new Set(parsed.data.file_ids);
        const newExcluded = currentExcluded.filter(f => !toRemove.has(f));

        await writeMediaTypeSettingsFile(paths.baseDir, {
            kind: settings.kind,
            schema: settings.schema,
            excludedFiles: newExcluded
        });

        return json({ success: true, excludedFiles: newExcluded });
    } catch (err) {
        console.error('API /excluded/clean error:', err);
        const e = err as any;
        if (e.status) throw err;
        throw error(500, e.message ?? 'Internal error');
    }
};
