import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import exifr from 'exifr';

const imagesDirPath = 'src/lib/assets/images';

/**
 * GET handler for extracting actual image file metadata
 * Reads EXIF data, dimensions, color space, and other file properties
 * 
 * @param params.filename - The filename of the image to analyze
 * @returns JSON object containing comprehensive image metadata
 * 
 * #NOTE: Future concerns:
 * - Performance: Large images may take time to process
 * - Memory usage: Sharp loads entire image into memory
 * - Error handling: Could be more specific for different image format issues
 * - Security: Should validate file paths to prevent directory traversal
 */
export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;
	
	if (!filename) {
		throw error(400, 'Filename is required');
	}
	
	const filePath = path.join(imagesDirPath, filename);
	
	try {
		// Check if file exists
		if (!fs.existsSync(filePath)) {
			throw error(404, 'Image file not found');
		}
		
		// Get file stats
		const stats = fs.statSync(filePath);
		
		// Use sharp to extract metadata
		const image = sharp(filePath);
		const metadata = await image.metadata();
		
		// Get EXIF data if available
		const exifData = await parseExifData(filePath);
		
		// Get raw EXIF data for debugging
		const rawExifData = metadata.exif ? {
			buffer: metadata.exif.toString('base64'),
			size: metadata.exif.length
		} : null;
		
		// Construct comprehensive metadata object
		const fileMetadata = {
			// Basic file information
			filename: filename,
			fileSize: stats.size,
			fileSizeFormatted: formatFileSize(stats.size),
			dateCreated: stats.birthtime,
			dateModified: stats.mtime,
			
			// Image dimensions and format
			width: metadata.width,
			height: metadata.height,
			format: metadata.format,
			density: metadata.density,
			channels: metadata.channels,
			depth: metadata.depth,
			
			// Color information
			space: metadata.space,
			hasAlpha: metadata.hasAlpha,
			hasProfile: metadata.hasProfile,
			
			// EXIF data (if available)
			exif: exifData,
			rawExif: rawExifData, // Raw EXIF for debugging
			
			// Additional metadata
			orientation: metadata.orientation,
			compression: metadata.compression,
			resolutionUnit: metadata.resolutionUnit,
			
			// Sharp-specific metadata
			isProgressive: metadata.isProgressive,
			pages: metadata.pages,
			pageHeight: metadata.pageHeight,
			loop: metadata.loop,
			delay: metadata.delay,
			
			// Calculated properties
			aspectRatio: metadata.width && metadata.height ? 
				(metadata.width / metadata.height).toFixed(2) : null,
			megapixels: metadata.width && metadata.height ? 
				((metadata.width * metadata.height) / 1000000).toFixed(2) : null
		};
		
		return json(fileMetadata);
		
	} catch (err) {
		console.error('Error reading image metadata:', err);
		
		// Handle specific Sharp errors
		if (err && typeof err === 'object' && 'message' in err) {
			const errorMessage = err.message as string;
			if (errorMessage.includes('Input file is missing')) {
				throw error(404, 'Image file not found');
			}
			if (errorMessage.includes('Input file contains unsupported image format')) {
				throw error(400, 'Unsupported image format');
			}
		}
		
		throw error(500, 'Failed to read image metadata');
	}
};

/**
 * Parse EXIF data from image file using exifr library
 * Extracts comprehensive EXIF data including camera settings, GPS, etc.
 * 
 * @param filePath - Path to the image file
 * @returns Object with parsed EXIF data or null if parsing fails
 */
async function parseExifData(filePath: string): Promise<Record<string, any> | null> {
	try {
		const exifData = await exifr.parse(filePath, {
			// Enable comprehensive EXIF parsing
			tiff: true,
			exif: true,
			gps: true,
			iptc: true,
			icc: true,
			jfif: true,
			ihdr: true,
			xmp: true,
			mergeOutput: false,
			sanitize: false,
			reviveValues: true,
			translateKeys: true,
			translateValues: true,
		});
		
		return exifData || null;
	} catch (error) {
		console.error('Error parsing EXIF data:', error);
		return null;
	}
}

/**
 * Format file size in human-readable format
 * 
 * @param bytes - File size in bytes
 * @returns Formatted string with appropriate unit
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