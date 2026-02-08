import { exiftool } from 'exiftool-vendored';
import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const OVERWRITE_ORIGINAL = '-overwrite_original';

/** Magic bytes for common image formats. ExifTool rejects files when extension doesn't match content. Check longer signatures first. */
const MAGIC: { bytes: number[]; ext: string }[] = [
	{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: '.png' },
	{ bytes: [0xff, 0xd8, 0xff], ext: '.jpg' },
	{ bytes: [0x52, 0x49, 0x46, 0x46], ext: '.webp' } // RIFF
];

/**
 * Detect the actual image format from file magic bytes so we can use the correct extension for ExifTool.
 * ExifTool errors with "Not a valid PNG (looks more like a JPEG)" when extension doesn't match content.
 *
 * @param filePath - Absolute path to the file
 * @returns Extension including dot (e.g. '.jpg', '.png') or null if unknown; caller should fall back to path.extname()
 */
async function detectExtensionFromMagic(filePath: string): Promise<string | null> {
	const fd = await fs.open(filePath, 'r');
	try {
		const buf = Buffer.alloc(12);
		const { bytesRead } = await fd.read(buf, 0, 12, 0);
		if (bytesRead < 3) return null;
		for (const { bytes, ext } of MAGIC) {
			if (bytes.length <= bytesRead && bytes.every((b, i) => buf[i] === b)) return ext;
		}
		return null;
	} finally {
		await fd.close();
	}
}

/**
 * Read image metadata from a file on disk using exiftool-vendored.
 * Returns a response shape compatible with the existing API and MetadataButton UI.
 *
 * @param imagesDir - Absolute directory containing images
 * @param filename - Safe image filename (basename)
 * @returns Comprehensive metadata object suitable for JSON response
 *
 * Concerns / future improvements:
 * - For large images, consider caching metadata or streaming where possible.
 * - Consider redacting raw EXIF for privacy by default.
 */
export async function readImageFileMetadata(imagesDir: string, filename: string) {
	const filePath = path.join(imagesDir, filename);

	if (!fssync.existsSync(filePath)) {
		const err = new Error('Image file not found');
		(err as any).status = 404;
		throw err;
	}

	const stats = await fs.stat(filePath);
	const fileExt = path.extname(filename).toLowerCase();
	const detectedExt = await detectExtensionFromMagic(filePath);
	const norm = (e: string) => (e === '.jpeg' ? '.jpg' : e);
	const extensionMismatch =
		detectedExt != null && norm(fileExt) !== norm(detectedExt.toLowerCase());

	const tags = await exiftool.read(filePath);

	const width = tags.ImageWidth ?? null;
	const height = tags.ImageHeight ?? null;
	const format = tags.FileType?.toLowerCase?.() ?? null;

	// Build exif-like object from all tags (excluding a few we map explicitly) for the UI
	const explicitKeys = new Set([
		'ImageWidth',
		'ImageHeight',
		'FileType',
		'FileName',
		'Directory',
		'FileSize',
		'FileModifyDate',
		'FileAccessDate',
		'FileCreateDate',
		'FileInodeChangeDate',
		'SourceFile'
	]);
	const exif: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tags)) {
		if (key === 'errors' || explicitKeys.has(key)) continue;
		if (value !== undefined && value !== null) exif[key] = value;
	}

	return {
		filename,
		fileSize: stats.size,
		fileSizeFormatted: formatFileSize(stats.size),
		dateCreated: stats.birthtime,
		dateModified: stats.mtime,

		...(extensionMismatch && detectedExt
			? {
					extensionMismatch: true as const,
					fileExtension: fileExt || undefined,
					detectedFormatExtension: detectedExt
				}
			: {}),

		width: width ?? undefined,
		height: height ?? undefined,
		format: format ?? undefined,
		density: (tags as Record<string, unknown>).XResolution ?? undefined,
		channels: (tags as Record<string, unknown>).ColorComponents ?? undefined,
		depth: (tags as Record<string, unknown>).BitsPerSample ?? undefined,

		space: undefined,
		hasAlpha: undefined,
		hasProfile: undefined,

		exif: Object.keys(exif).length > 0 ? exif : null,
		rawExif: null,

		orientation: (tags as Record<string, unknown>).Orientation ?? undefined,
		compression: (tags as Record<string, unknown>).Compression ?? undefined,
		resolutionUnit: (tags as Record<string, unknown>).ResolutionUnit ?? undefined,

		isProgressive: undefined,
		pages: undefined,
		pageHeight: undefined,
		loop: undefined,
		delay: undefined,

		aspectRatio:
			width != null && height != null ? (width / height).toFixed(2) : null,
		megapixels:
			width != null && height != null
				? ((width * height) / 1_000_000).toFixed(2)
				: null
	};
}

/**
 * Strip metadata from an image file: either all writable metadata or only GPS-related tags.
 * Writes to a temp file in the same directory then atomically renames over the original
 * to avoid corrupting the file on failure.
 *
 * @param imagesDir - Absolute directory containing the image
 * @param filename - Safe image filename (basename)
 * @param options - { all: true } to strip all metadata, or { gpsOnly: true } to strip only GPS/Geolocation tags
 *
 * Concerns / future improvements:
 * - Idempotent: clearing an already-cleared file (or GPS when none) is a no-op.
 */
export async function stripImageFileMetadata(
	imagesDir: string,
	filename: string,
	options: { all?: boolean; gpsOnly?: boolean }
): Promise<void> {
	const filePath = path.join(imagesDir, filename);
	if (!fssync.existsSync(filePath)) {
		const err = new Error('Image file not found');
		(err as any).status = 404;
		throw err;
	}

	const ext = path.extname(filename);
	const base = path.basename(filename, ext);
	// Use actual format from magic bytes so ExifTool doesn't error "Not a valid PNG (looks more like a JPEG)"
	const actualExt = (await detectExtensionFromMagic(filePath)) ?? ext;
	const tempPath = path.join(imagesDir, `${base}.tmp${actualExt}`);

	try {
		await fs.copyFile(filePath, tempPath);
	} catch (e) {
		const err = new Error('Failed to create temp file for metadata strip');
		(err as any).cause = e;
		throw err;
	}

	/** ExifTool backup is filename + "_original" (e.g. base.tmp.jpg_original). */
	const tempBackupPath = tempPath + '_original';

	try {
		if (options.all) {
			// deleteAllTags strips the file and creates file_original backup; we keep stripped file and remove backup
			await exiftool.deleteAllTags(tempPath);
			if (fssync.existsSync(tempBackupPath)) {
				await fs.unlink(tempBackupPath).catch(() => {});
			}
		} else if (options.gpsOnly) {
			await exiftool.write(tempPath, {}, [
				'-GPS*=',
				'-Geolocation*=',
				OVERWRITE_ORIGINAL
			]);
		} else {
			throw new Error('stripImageFileMetadata: specify options.all or options.gpsOnly');
		}
	} catch (e) {
		await fs.unlink(tempPath).catch(() => {});
		await fs.unlink(tempBackupPath).catch(() => {});
		throw e;
	}

	try {
		await fs.rename(tempPath, filePath);
	} catch (e) {
		await fs.unlink(tempPath).catch(() => {});
		const err = new Error('Failed to replace file after metadata strip');
		(err as any).cause = e;
		throw err;
	}
}

/**
 * Format a byte size in a human-readable form.
 *
 * @param bytes - Size in bytes
 * @returns Formatted string like `1.23 MB`
 */
function formatFileSize(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}
	return `${size.toFixed(2)} ${units[unitIndex]}`;
}
