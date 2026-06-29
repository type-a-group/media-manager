import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getGlobalFilesDir } from '$lib/storage/paths.js';
import { assertSafeBasename } from '$lib/storage/filenames.js';
import { registerBlob } from '$lib/storage/classRepo.js';
import { maybeConvertHeic } from '$lib/server/heicConvert.js';

/** Append (1), (2)… to a basename until it is unique within `dir`. */
function uniqueName(baseFilename: string, dir: string): string {
	if (!fs.existsSync(path.join(dir, baseFilename))) return baseFilename;
	const ext = path.extname(baseFilename);
	const name = path.basename(baseFilename, ext);
	for (let n = 1; n <= 9999; n++) {
		const candidate = `${name} (${n})${ext}`;
		if (!fs.existsSync(path.join(dir, candidate))) return candidate;
	}
	throw new Error('Too many filename conflicts');
}

/**
 * POST: Upload a blob into the global `media/files/` store (any file type). HEIC/HEIF is converted to
 * JPEG. Accepts multipart/form-data with a `file` (or legacy `image`) field and optional
 * `conflict_resolution` (`overwrite` | `auto-rename`). Returns the blob's manifest `id`.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const filesDir = getGlobalFilesDir();
		if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

		const formData = await request.formData();
		const upload = (formData.get('file') ?? formData.get('image')) as File | null;
		if (!upload) throw error(400, 'No file provided');

		const conflictResolution = formData.get('conflict_resolution') as string | null;
		const arrayBuffer = await upload.arrayBuffer();
		const { buffer, filename, converted } = await maybeConvertHeic(
			Buffer.from(arrayBuffer),
			upload.name,
			upload.type
		);
		let safeFileName: string;

		if (converted) {
			safeFileName = assertSafeBasename(filename);
		} else {
			safeFileName = assertSafeBasename(
				path.basename(upload.name).replace(/[^a-zA-Z0-9.\-_ ]/g, '_')
			);
		}

		if (fs.existsSync(path.join(filesDir, safeFileName))) {
			if (conflictResolution === 'overwrite') {
				/* proceed */
			} else if (conflictResolution === 'auto-rename') {
				safeFileName = uniqueName(safeFileName, filesDir);
			} else {
				throw error(409, { message: `File "${safeFileName}" already exists` });
			}
		}

		fs.writeFileSync(path.join(filesDir, safeFileName), buffer);
		const id = await registerBlob(safeFileName, buffer.length);
		return json({ success: true, id, file_id: id, filename: safeFileName });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		console.error('Upload error:', e);
		throw error(500, { message: e.message ?? 'Upload failed' });
	}
};
