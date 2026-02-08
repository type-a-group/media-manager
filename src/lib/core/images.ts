/**
 * Canonical image extensions supported by this app.
 *
 * Use case:
 * - Used for safe filename validation and for filtering directories.
 *
 * Concerns / future improvements:
 * - Consider adding `webp` if/when sharp pipeline and UI support it.
 */
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.svg'] as const;
export type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

/**
 * Allowed MIME types for upload endpoints.
 *
 * Use case:
 * - Used by upload route and client-side validation.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/svg+xml'
] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * Returns true if the filename ends with an allowed image extension.
 *
 * @param filename - Image filename
 * @returns boolean
 */
export function hasAllowedImageExtension(filename: string): boolean {
	const lower = filename.toLowerCase();
	return ALLOWED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

