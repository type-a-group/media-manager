import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from '$lib/storage/settingsFile.js';
import { z } from 'zod';

const RequestSchema = z.object({
    filenames: z.array(z.string()).min(1)
});

export const POST: RequestHandler = async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
        throw error(400, 'Invalid request body. Expected { filenames: string[] }');
    }

    try {
        const typeId = params.typeId;
        const paths = getMediaTypePaths(typeId);
        const settings = readMediaTypeSettingsFileSync(paths.baseDir);
        if (!settings) throw error(404, 'Media type settings not found');

        const currentExcluded = settings.excludedFiles ?? [];
        const toRemove = new Set(parsed.data.filenames);
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
