/**
 * Canonical file extensions this app will store and list.
 *
 * Use case:
 * - Used for safe filename validation and for filtering directories.
 * - HEIC/HEIF are accepted for upload but converted to JPEG server-side (browsers can't display them natively).
 * - PDFs are stored as-is (no conversion); they are not raster images, but this is the single
 *   allowlist of files an "images" media type may hold. See [[future-pdf-file-support]] in tasks.md
 *   for the planned inline PDF viewer.
 */
export const ALLOWED_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.heic', '.heif', '.pdf'] as const;
export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number];

/**
 * Allowed MIME types for upload endpoints.
 *
 * Use case:
 * - Used by upload route and client-side validation.
 */
export const ALLOWED_FILE_MIME_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/svg+xml',
	'image/webp',
	'image/heic',
	'image/heif',
	'application/pdf'
] as const;
export type AllowedFileMimeType = (typeof ALLOWED_FILE_MIME_TYPES)[number];

/**
 * File extensions for which file metadata can be extracted.
 *
 * Use case:
 * - Drives the metadata button's enabled vs faded state in the editor.
 * - Excludes vector formats (e.g. SVG) that carry no meaningful metadata.
 * - Raster images yield EXIF / image properties; PDFs yield document properties
 *   (title, author, page count, etc.) — both read via exiftool.
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
 * Returns true if the filename ends with an allowed file extension.
 *
 * @param filename - File name
 * @returns boolean
 */
export function hasAllowedFileExtension(filename: string): boolean {
	const lower = filename.toLowerCase();
	return ALLOWED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Returns true if file metadata can be extracted for the given filename.
 *
 * @param filename - Image filename
 * @returns boolean
 */
export function supportsFileMetadata(filename: string): boolean {
	return (METADATA_SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(filename));
}

/**
 * Returns true if the filename is a PDF.
 *
 * Use case:
 * - Drives the icon-placeholder branches in the editor / grid / sidebar, where PDFs
 *   cannot be rendered in an `<img>` tag.
 *
 * Concerns / future improvements:
 * - When inline PDF viewing lands (see tasks.md), callers may switch from an icon
 *   placeholder to an embedded viewer keyed off this same check.
 */
export function isPdfFilename(filename: string): boolean {
	return fileExtension(filename) === '.pdf';
}

