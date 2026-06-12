import { z } from 'zod';

/**
 * Runtime schema for an `imageId` — the stable identity used by API endpoints and UI selection.
 *
 * Use case:
 * - For **file-backed** kinds (`images` / `generic` / `blob_store`) the id is the blob's workspace-wide
 *   identity (a UUID minted in the global manifest). A catalog row's primary key `id` *is* this value,
 *   so the same id can appear in multiple catalogs that reference the same blob.
 * - For **json** kinds the id is the record's own minted UUID.
 *
 * Concerns / future improvements:
 * - Using UUIDs is simple and portable, but a shorter id (nanoid/base62) may be nicer for logs/CLI.
 * - The legacy `unlinked:<name>` id scheme was removed when blobs gained a stable `file_id`: an
 *   unlinked file is now simply a manifest `file_id` that has no row in this catalog, so it keeps the
 *   same id whether linked or not.
 */
export const ImageIdSchema = z.string().uuid();
export type ImageId = z.infer<typeof ImageIdSchema>;

/**
 * Runtime schema for a `file_id` — a blob's stable, workspace-scoped identity in the global manifest
 * (`<root>/files/manifest.json`). Independent of the (mutable) filename on disk.
 *
 * Use case:
 * - Cross-catalog primary key for blobs in the shared global `files/` store. The same physical blob
 *   referenced by many media types shares one `file_id`.
 */
export const FileIdSchema = z.string().uuid();
export type FileId = z.infer<typeof FileIdSchema>;

/**
 * Generate a new UUID id (used for both json record ids and freshly minted `file_id`s).
 *
 * @returns A UUID string.
 *
 * Concerns / future improvements:
 * - If we ever need deterministic ids (e.g. reproducible sync), switch generation strategy and keep
 *   the validator compatible.
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

/**
 * Mint a new `file_id`. Alias of {@link newImageId}; named separately so blob-registry call sites read
 * clearly and so the two concepts can diverge later without churn.
 */
export function newFileId(): FileId {
	return newImageId() as FileId;
}
