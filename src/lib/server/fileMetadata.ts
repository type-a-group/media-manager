import { exiftool } from 'exiftool-vendored';
import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { orientationCorrectedDimensions } from '$lib/core/images.js';

const OVERWRITE_ORIGINAL = '-overwrite_original';

/** Magic bytes for common image formats. ExifTool rejects files when extension doesn't match content. Check longer signatures first. */
const MAGIC: { bytes: number[]; ext: string; offset?: number }[] = [
	{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: '.png' },
	{ bytes: [0xff, 0xd8, 0xff], ext: '.jpg' },
	{ bytes: [0x52, 0x49, 0x46, 0x46], ext: '.webp' }, // RIFF
	{ bytes: [0x25, 0x50, 0x44, 0x46], ext: '.pdf' } // %PDF
];

/** HEIC/HEIF ftyp brands (at byte offset 4). */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'hevx'];

/**
 * Check if a buffer represents a HEIC/HEIF file by looking for an ftyp box.
 */
function isHeicBuffer(buf: Buffer, bytesRead: number): boolean {
	if (bytesRead < 12) return false;
	// ftyp box: bytes 4-7 should be 'ftyp'
	if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) return false;
	const brand = buf.subarray(8, 12).toString('ascii');
	return HEIC_BRANDS.includes(brand);
}

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
		if (isHeicBuffer(buf, bytesRead)) return '.heic';
		return null;
	} finally {
		await fd.close();
	}
}

/** exiftool tag keys mapped to explicit top-level fields (excluded from the generic `exif` blob). */
const COMMON_EXPLICIT_KEYS = new Set([
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

/** exiftool PDF tag keys mapped to explicit top-level fields (excluded from the generic `exif` blob). */
const PDF_EXPLICIT_KEYS = new Set([
	'Title',
	'Author',
	'Subject',
	'Keywords',
	'Creator',
	'Producer',
	'PDFVersion',
	'PageCount',
	'Encryption',
	'CreateDate',
	'ModifyDate'
]);

/**
 * Build the generic `exif` blob from all exiftool tags except system tags and any explicitly-mapped ones.
 *
 * @param tags - Raw exiftool tags
 * @param extraExclude - Additional tag keys to omit (e.g. ones mapped to top-level PDF fields)
 * @returns Object of remaining tag key/value pairs (never null; caller decides on emptiness)
 *
 * Use case:
 * - Preserves "whatever information we can get" from a file under one blob, without duplicating
 *   the values surfaced as friendly top-level fields.
 */
function buildExifBlob(
	tags: Record<string, unknown>,
	extraExclude: ReadonlySet<string> = new Set()
): Record<string, unknown> {
	const exif: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tags)) {
		if (key === 'errors' || COMMON_EXPLICIT_KEYS.has(key) || extraExclude.has(key)) continue;
		if (value !== undefined && value !== null) exif[key] = value;
	}
	return exif;
}

/**
 * Build the metadata response for a PDF document.
 *
 * @param base - Shared base fields (filename, size, dates, optional extension-mismatch info)
 * @param tags - Raw exiftool tags read from the PDF
 * @returns Metadata object in the same shape the UI consumes, with document fields populated and
 *          image-only fields left undefined.
 *
 * Use case:
 * - PDFs carry document properties (title, author, page count) rather than image EXIF; this maps
 *   the common PDF tags to friendly fields while keeping everything else under `exif`.
 *
 * Concerns / future improvements:
 * - exiftool exposes more PDF tags (e.g. Linearized, Trapped); these are retained in `exif`.
 */
function buildPdfMetadata(base: Record<string, unknown>, tags: Record<string, unknown>) {
	const str = (v: unknown) => (v == null ? undefined : String(v));
	const exif = buildExifBlob(tags, PDF_EXPLICIT_KEYS);
	return {
		...base,
		format: 'pdf',

		title: str(tags.Title),
		author: str(tags.Author),
		subject: str(tags.Subject),
		keywords: str(tags.Keywords),
		creator: str(tags.Creator),
		producer: str(tags.Producer),
		pdfVersion: str(tags.PDFVersion),
		pageCount: tags.PageCount != null ? Number(tags.PageCount) : undefined,
		encryption: str(tags.Encryption),
		pdfCreateDate: str(tags.CreateDate),
		pdfModifyDate: str(tags.ModifyDate),

		// Image-only fields are not applicable to PDFs.
		width: undefined,
		height: undefined,
		density: undefined,
		channels: undefined,
		depth: undefined,
		space: undefined,
		hasAlpha: undefined,
		hasProfile: undefined,

		exif: Object.keys(exif).length > 0 ? exif : null,
		rawExif: null,

		orientation: undefined,
		compression: undefined,
		resolutionUnit: undefined,
		isProgressive: undefined,
		pages: undefined,
		pageHeight: undefined,
		loop: undefined,
		delay: undefined,

		aspectRatio: null,
		megapixels: null
	};
}

/**
 * Read file metadata from a file on disk using exiftool-vendored.
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

	const isPdf =
		fileExt === '.pdf' || detectedExt === '.pdf' || tags.FileType?.toLowerCase?.() === 'pdf';

	// Fields shared by every supported file type.
	const base = {
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
			: {})
	};

	if (isPdf) return buildPdfMetadata(base, tags as Record<string, unknown>);

	const width = tags.ImageWidth ?? null;
	const height = tags.ImageHeight ?? null;
	const format = tags.FileType?.toLowerCase?.() ?? null;

	const exif = buildExifBlob(tags as Record<string, unknown>);

	return {
		...base,

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

		aspectRatio: width != null && height != null ? (width / height).toFixed(2) : null,
		megapixels: width != null && height != null ? ((width * height) / 1_000_000).toFixed(2) : null
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
			await exiftool.write(tempPath, {}, ['-GPS*=', '-Geolocation*=', OVERWRITE_ORIGINAL]);
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
 * Read only the width and height of an image file using exiftool.
 * Returns { width, height } or undefined values if not available.
 *
 * @param filePath - Absolute path to the image file
 * @returns Object with width and height (numbers or undefined)
 *
 * Concerns / future improvements:
 * - PDFs are skipped: exiftool reports page size in points, not pixels, and the sidebar renders
 *   these as "W × H px", which would be misleading. Returns undefined dimensions for PDFs.
 */
export async function readImageDimensions(
	filePath: string
): Promise<{ width: number | undefined; height: number | undefined }> {
	if (path.extname(filePath).toLowerCase() === '.pdf') {
		return { width: undefined, height: undefined };
	}
	try {
		const tags = await exiftool.read(filePath);
		return {
			width: typeof tags.ImageWidth === 'number' ? tags.ImageWidth : undefined,
			height: typeof tags.ImageHeight === 'number' ? tags.ImageHeight : undefined
		};
	} catch {
		return { width: undefined, height: undefined };
	}
}

/** Outcome of comparing a blob's stored manifest dimensions against the real image (Item 13). */
export interface DimensionConsistency {
	/** Dimensions currently stored in the manifest (either may be undefined). */
	stored: { width: number | undefined; height: number | undefined };
	/** Raw pixel dimensions read from the file (pre-orientation), or undefined if unreadable. */
	fileRaw: { width: number | undefined; height: number | undefined };
	/** EXIF Orientation tag value (1–8), or undefined when absent. */
	orientation: number | undefined;
	/** Orientation-corrected (displayed) dimensions — what the image actually looks like. */
	corrected: { width: number; height: number } | undefined;
	/** True iff stored dims exist and disagree with `corrected` (the actionable mismatch). */
	mismatch: boolean;
}

/**
 * Pure comparison of stored manifest dimensions against an image's raw dimensions + EXIF Orientation.
 * No IO — the single source of the "are the stored dims right?" rule, shared by the standalone check
 * (which reads the file) and the metadata endpoint (which already has these values).
 *
 * A mismatch is only flagged when stored dimensions actually exist — an un-backfilled blob is not
 * "wrong", just unmeasured (the normal lazy backfill handles that). Missing raw dims ⇒ no mismatch.
 *
 * @param stored - Dimensions currently stored in the manifest.
 * @param fileRaw - Raw (pre-orientation) pixel dimensions read from the file.
 * @param orientation - EXIF Orientation tag value (1–8), or undefined when absent.
 * @returns A {@link DimensionConsistency} describing the comparison.
 */
export function compareStoredVsImage(
	stored: { width: number | undefined; height: number | undefined },
	fileRaw: { width: number | undefined; height: number | undefined },
	orientation: number | undefined
): DimensionConsistency {
	if (fileRaw.width == null || fileRaw.height == null) {
		return { stored, fileRaw, orientation, corrected: undefined, mismatch: false };
	}
	const corrected = orientationCorrectedDimensions(fileRaw.width, fileRaw.height, orientation);
	const mismatch =
		stored.width != null &&
		stored.height != null &&
		(stored.width !== corrected.width || stored.height !== corrected.height);
	return { stored, fileRaw, orientation, corrected, mismatch };
}

/**
 * Compare a blob's stored manifest dimensions against the real image, accounting for EXIF Orientation.
 *
 * Reads the file's raw `ImageWidth`/`ImageHeight` + `Orientation` via exiftool, then defers to
 * {@link compareStoredVsImage}. Fails safe: any read error, a PDF, or unreadable dimensions yield
 * `mismatch: false`.
 *
 * @param filePath - Absolute path to the blob.
 * @param stored - The dimensions currently stored in the manifest for this blob.
 * @returns A {@link DimensionConsistency} describing the comparison.
 *
 * Use case:
 * - Drives the Item 13 "stored dimensions look wrong" warning badge + the smart "Correct dimensions"
 *   fix (the lightweight `/dimension-check` endpoint).
 */
export async function dimensionConsistency(
	filePath: string,
	stored: { width: number | undefined; height: number | undefined }
): Promise<DimensionConsistency> {
	const empty: DimensionConsistency = {
		stored,
		fileRaw: { width: undefined, height: undefined },
		orientation: undefined,
		corrected: undefined,
		mismatch: false
	};
	if (path.extname(filePath).toLowerCase() === '.pdf') return empty;
	let tags;
	try {
		tags = await exiftool.read(filePath);
	} catch {
		return empty;
	}
	const rawW = typeof tags.ImageWidth === 'number' ? tags.ImageWidth : undefined;
	const rawH = typeof tags.ImageHeight === 'number' ? tags.ImageHeight : undefined;
	const orientation = typeof tags.Orientation === 'number' ? tags.Orientation : undefined;
	return compareStoredVsImage(stored, { width: rawW, height: rawH }, orientation);
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
