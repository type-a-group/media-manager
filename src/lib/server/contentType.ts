import path from 'node:path';

/** Map of stored file extensions to the Content-Type used when serving their bytes. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.pdf': 'application/pdf'
};

/**
 * Returns the HTTP Content-Type for a stored file based on its extension.
 *
 * @param filename - Stored file name (or path); only the extension is used
 * @returns A MIME type string, falling back to 'application/octet-stream' for unknown extensions
 *
 * Use case:
 * - Single source of truth for the file-serving routes so a new supported type (e.g. PDF)
 *   only needs to be added here.
 *
 * Concerns / future improvements:
 * - HEIC/HEIF are intentionally absent: they are converted to JPEG on upload and never served raw.
 */
export function contentTypeForFile(filename: string): string {
	const ext = path.extname(filename).toLowerCase();
	return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}
