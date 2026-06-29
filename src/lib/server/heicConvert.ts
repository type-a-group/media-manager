import * as path from 'node:path';
import convert from 'heic-convert';

/**
 * Shared HEIC/HEIF → JPEG conversion helper.
 *
 * Use case:
 * - Both the upload route (`/api/files/upload`) and the Google Photos import route
 *   (`/api/google-photos/import`) receive raw bytes that may be HEIC/HEIF, which browsers can't
 *   render. This is the single place that decides whether a buffer needs converting and performs it,
 *   so the two ingest paths don't duplicate the logic (Item 37 factoring).
 *
 * Note: this helper only converts and suggests a `.jpg` filename — it deliberately does **not** run
 * `assertSafeBasename` or conflict resolution, so each caller keeps its own filename-sanitization and
 * uniqueness policy.
 */

/** HEIC/HEIF MIME types that require conversion (browsers can't render them). */
const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

/** True when a MIME type is HEIC/HEIF (case-insensitive). */
export function isHeicMime(mime: string): boolean {
	return HEIC_MIME_TYPES.includes(mime.toLowerCase());
}

/** True when a filename's extension is `.heic`/`.heif` (case-insensitive). */
export function isHeicExtension(filename: string): boolean {
	const ext = path.extname(filename).toLowerCase();
	return ext === '.heic' || ext === '.heif';
}

/**
 * Convert a buffer to JPEG **iff** it looks like HEIC/HEIF (by MIME or extension); otherwise pass it
 * through unchanged.
 *
 * @param buffer - The raw file bytes.
 * @param filename - The original filename (used to sniff the extension and derive the `.jpg` name).
 * @param mime - The reported MIME type (used to sniff HEIC).
 * @returns The (possibly converted) buffer, a suggested filename (`<base>.jpg` when converted, else
 *   the original), and a `converted` flag. The suggested filename is **not** yet safe-basename'd.
 */
export async function maybeConvertHeic(
	buffer: Buffer,
	filename: string,
	mime: string
): Promise<{ buffer: Buffer; filename: string; converted: boolean }> {
	if (!isHeicMime(mime) && !isHeicExtension(filename)) {
		return { buffer, filename, converted: false };
	}
	const converted = await convert({
		buffer: buffer as unknown as ArrayBufferLike,
		format: 'JPEG',
		quality: 0.92
	});
	const out = Buffer.from(converted instanceof Uint8Array ? converted : new Uint8Array(converted));
	const baseName = path.basename(filename, path.extname(filename));
	return { buffer: out, filename: `${baseName}.jpg`, converted: true };
}
