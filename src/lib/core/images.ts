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

/**
 * EXIF Orientation values (5–8) that rotate the image by a quarter turn, swapping its displayed
 * width and height relative to the stored (raw) pixel dimensions.
 *
 * Use case:
 * - The raw `ImageWidth`/`ImageHeight` exiftool reads describe the *stored* pixels; a viewer that
 *   honours EXIF orientation shows a 90°/270° image transposed. To know what the image actually
 *   *looks like* (and what should be persisted as its dimensions) we must account for this.
 *
 * Orientation reference: 1 normal · 2 flip-h · 3 180° · 4 flip-v · 5 transpose · 6 rotate 90° CW ·
 * 7 transverse · 8 rotate 90° CCW. Only 5–8 are quarter turns.
 */
const QUARTER_TURN_ORIENTATIONS = new Set([5, 6, 7, 8]);

/**
 * Returns true when an EXIF Orientation rotates the image by a quarter turn, so its displayed
 * dimensions are the stored dimensions transposed.
 *
 * @param orientation - EXIF Orientation tag value (1–8), or undefined/0 when absent.
 * @returns boolean — true for orientations 5, 6, 7, 8; false otherwise (including unknown/absent).
 */
export function orientationSwapsDimensions(orientation: number | undefined | null): boolean {
	return orientation != null && QUARTER_TURN_ORIENTATIONS.has(orientation);
}

/**
 * Apply an EXIF Orientation to a pair of stored (raw) pixel dimensions, returning the dimensions as
 * the image is actually *displayed*. For quarter-turn orientations (5–8) width and height are
 * swapped; for all others they pass through unchanged.
 *
 * @param width - Stored (raw) pixel width, e.g. exiftool `ImageWidth`.
 * @param height - Stored (raw) pixel height, e.g. exiftool `ImageHeight`.
 * @param orientation - EXIF Orientation tag value (1–8), or undefined/0 when absent (⇒ no swap).
 * @returns `{ width, height }` as displayed — transposed iff {@link orientationSwapsDimensions}.
 *
 * Use case:
 * - The single source of truth for the "what shape is this image really?" rule, shared by the
 *   server-side consistency check and any client display. Keeps the orientation logic in one place.
 */
export function orientationCorrectedDimensions(
	width: number,
	height: number,
	orientation: number | undefined | null
): { width: number; height: number } {
	return orientationSwapsDimensions(orientation)
		? { width: height, height: width }
		: { width, height };
}
