/**
 * Canonical image extensions supported by this app.
 *
 * Use case:
 * - Used for safe filename validation and to decide whether a stored file can render as an image
 *   (thumbnails, `<img>` previews).
 * - HEIC/HEIF are accepted for upload but converted to JPEG server-side (browsers can't display them natively).
 *
 * Concerns / future improvements:
 * - This is intentionally image-only. Document/other file types (e.g. PDF) are stored and read for
 *   metadata but are not images; use {@link supportsFileMetadata} / {@link isPdfFilename} for those.
 */
export const ALLOWED_IMAGE_EXTENSIONS = [
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.svg',
	'.webp',
	'.heic',
	'.heif'
] as const;
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
	'image/svg+xml',
	'image/webp',
	'image/heic',
	'image/heif'
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

/**
 * File extensions for which file metadata can be extracted (via exiftool).
 *
 * Use case:
 * - Drives the metadata button's enabled vs faded state.
 * - Excludes vector formats (e.g. SVG) that carry no meaningful metadata.
 * - Raster images yield EXIF / image properties; PDFs yield document properties
 *   (title, author, page count, etc.).
 */
export const METADATA_SUPPORTED_EXTENSIONS = [
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.webp',
	'.heic',
	'.heif',
	'.pdf'
] as const;
export type MetadataSupportedExtension = (typeof METADATA_SUPPORTED_EXTENSIONS)[number];

/**
 * Returns the lowercased extension (including the dot) of a filename, or '' if none.
 *
 * @param filename - File name or path
 * @returns Extension like '.png', or '' when there is no extension
 */
export function fileExtension(filename: string): string {
	const lower = filename.toLowerCase();
	const dot = lower.lastIndexOf('.');
	return dot >= 0 ? lower.slice(dot) : '';
}

/**
 * Returns true if file metadata can be extracted for the given filename.
 *
 * @param filename - File name
 * @returns boolean
 */
export function supportsFileMetadata(filename: string): boolean {
	return (METADATA_SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(filename));
}

/**
 * Returns true if the filename is a PDF.
 *
 * Use case:
 * - Drives PDF-specific UI branches (icon placeholder instead of an `<img>`, document metadata).
 *
 * Concerns / future improvements:
 * - When inline PDF viewing lands (see docs/FUTURE_CHANGES.md), callers may switch from an icon
 *   placeholder to an embedded viewer keyed off this same check.
 */
export function isPdfFilename(filename: string): boolean {
	return fileExtension(filename) === '.pdf';
}
