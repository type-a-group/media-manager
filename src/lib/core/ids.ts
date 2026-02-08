import { z } from 'zod';

/**
 * Runtime schema for an `imageId`.
 *
 * Use case:
 * - IDs are stored in `image-data.json` and used by API endpoints/UI selection.
 * - Linked records use a UUID. Unlinked list items (file on disk, not in JSON) use "unlinked:" + encoded filename.
 *
 * Concerns / future improvements:
 * - Using UUIDs is simple and portable, but a shorter ID (nanoid/base62) may be nicer for logs and CLI output.
 */
export const ImageIdSchema = z.union([
	z.string().uuid(),
	z.string().min(10).startsWith('unlinked:')
]);
export type ImageId = z.infer<typeof ImageIdSchema>;

/**
 * Generate a new `imageId`.
 *
 * @returns A UUID string suitable for `image-data.json`.
 *
 * Concerns / future improvements:
 * - If we ever need deterministic IDs (e.g. for reproducible sync), switch generation strategy and keep the
 *   validator compatible.
 */
export function newImageId(): ImageId {
	// Prefer native crypto.randomUUID when available (Node 19+, modern browsers).
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return (crypto as Crypto).randomUUID() as ImageId;
	}

	// Fallback: simple UUID v4 polyfill (good enough for local tools).
	const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
	const uuid = template.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
	return uuid as ImageId;
}

