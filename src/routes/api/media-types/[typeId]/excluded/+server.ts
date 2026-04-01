import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypePaths } from '$lib/storage/paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from '$lib/storage/settingsFile.js';
import { z } from 'zod';

const RequestSchema = z.object({
    filenames: z.array(z.string()).min(1),
    action: z.enum(['exclude', 'unexclude'])
});

export const POST: RequestHandler = async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
        throw error(400, 'Invalid request body. Expected { filenames: string[], action: "exclude" | "unexclude" }');
    }

    try {
        const typeId = params.typeId;
        const paths = getMediaTypePaths(typeId);
        const settings = readMediaTypeSettingsFileSync(paths.baseDir);
        if (!settings) throw error(404, 'Media type settings not found');

        let currentExcluded = settings.excludedFiles ?? [];
        const { filenames, action } = parsed.data;

        if (action === 'exclude') {
            const toAdd = filenames.filter(f => !currentExcluded.includes(f));
            currentExcluded = [...currentExcluded, ...toAdd];
        } else {
            const toRemove = new Set(filenames);
            currentExcluded = currentExcluded.filter(f => !toRemove.has(f));
        }

        await writeMediaTypeSettingsFile(paths.baseDir, {
            kind: settings.kind,
            schema: settings.schema,
            excludedFiles: currentExcluded
        });

        return json({ success: true, excludedFiles: currentExcluded });
    } catch (err) {
        console.error('API /excluded error:', err);
        const e = err as any;
        if (e.status) throw err;
        throw error(500, e.message ?? 'Internal error');
    }
};
