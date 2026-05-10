import path from 'node:path';
import { error } from '@sveltejs/kit';
import { hasAllowedImageExtension } from '$lib/core/images.js';

/**
 * Validate and normalize an image filename coming from persisted data.
 *
 * Use case:
 * - Prevent directory traversal or weird path edge cases when reading from disk.
 *
 * @param filename - Filename from image records
 * @returns A safe basename (same string if already safe)
 *
 * Concerns / future improvements:
 * - If you later allow subfolders, this should evolve to validate relative paths within a root,
 *   not just basenames.
 */
export function assertSafeImageFilename(filename: string): string {
	if (!filename || typeof filename !== 'string') {
		throw error(400, 'Invalid filename');
	}

	// Reject null bytes and path separators (including Windows-style separators).
	if (filename.includes('\0')) throw error(400, 'Invalid filename');
	if (filename.includes('/') || filename.includes('\\')) throw error(400, 'Invalid filename');

	// Ensure it’s a basename (no traversal).
	const base = path.basename(filename);
	if (base !== filename) throw error(400, 'Invalid filename');

	// Basic extension allowlist.
	if (!hasAllowedImageExtension(base)) throw error(400, 'Unsupported image extension');

	return base;
}

/**
 * Validate a filename is a safe single-segment basename (no traversal). Does **not** require an image extension.
 *
 * Use case:
 * - `generic` media types may store non-image files; use this instead of {@link assertSafeImageFilename} for those paths.
 *
 * @param filename - Proposed basename
 * @returns The same basename if valid
 *
 * Concerns / future improvements:
 * - Consider a max length and reserved-name denylist if users hit edge cases.
 */
export function assertSafeBasename(filename: string): string {
	if (!filename || typeof filename !== 'string') {
		throw error(400, 'Invalid filename');
	}
	if (filename.includes('\0')) throw error(400, 'Invalid filename');
	if (filename.includes('/') || filename.includes('\\')) throw error(400, 'Invalid filename');
	const base = path.basename(filename);
	if (base !== filename) throw error(400, 'Invalid filename');
	if (base === '.' || base === '..') throw error(400, 'Invalid filename');
	return base;
}

