import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { exiftool } from 'exiftool-vendored';
import {
	readImageFileMetadata,
	readImageDimensions,
	detectExtensionMismatch,
	detectExtensionFromMagic
} from './fileMetadata.js';
import { supportsFileMetadata, hasAllowedImageExtension, isPdfFilename } from '../core/images.js';

/**
 * Build a minimal, valid single-page PDF with a correct cross-reference table.
 *
 * @returns Buffer containing the PDF bytes
 *
 * Use case:
 * - Provides a real on-disk PDF for exiftool to read/write in tests without committing a binary
 *   fixture. Offsets are computed from the assembled body so exiftool can resolve every object.
 */
function buildMinimalPdf(): Buffer {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'
	];
	const header = '%PDF-1.4\n';
	let body = '';
	const offsets: number[] = [];
	let pos = header.length;
	objects.forEach((obj, i) => {
		offsets.push(pos);
		const chunk = `${i + 1} 0 obj\n${obj}\nendobj\n`;
		body += chunk;
		pos += chunk.length;
	});
	const xrefPos = pos;
	let xref = `xref\n0 ${objects.length + 1}\n`;
	xref += '0000000000 65535 f \n';
	for (const off of offsets) {
		xref += off.toString().padStart(10, '0') + ' 00000 n \n';
	}
	const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
	// latin1 keeps byte length == string length so the computed offsets stay correct.
	return Buffer.from(header + body + xref + trailer, 'latin1');
}

describe('core image/pdf extension helpers', () => {
	it('treats .pdf as a metadata-capable but non-image type', () => {
		// PDFs are not images (no thumbnail/<img> rendering) ...
		expect(hasAllowedImageExtension('doc.pdf')).toBe(false);
		expect(hasAllowedImageExtension('photo.jpg')).toBe(true);
		// ... but their document metadata can still be read.
		expect(supportsFileMetadata('doc.pdf')).toBe(true);
		expect(isPdfFilename('doc.PDF')).toBe(true);
		expect(isPdfFilename('photo.jpg')).toBe(false);
	});
});

describe('detectExtensionMismatch (Item 12, pure)', () => {
	it('flags a sniffed type that disagrees with the name extension', () => {
		const r = detectExtensionMismatch('photo.jpg', '.png');
		expect(r.mismatch).toBe(true);
		expect(r.fileExtension).toBe('.jpg');
		expect(r.detectedExtension).toBe('.png');
	});

	it('does not flag a matching extension', () => {
		expect(detectExtensionMismatch('photo.png', '.png').mismatch).toBe(false);
	});

	it('treats .jpeg/.jpg and .tiff/.tif as equivalent (no mismatch)', () => {
		expect(detectExtensionMismatch('photo.jpeg', '.jpg').mismatch).toBe(false);
		expect(detectExtensionMismatch('scan.tiff', '.tif').mismatch).toBe(false);
	});

	it('is case-insensitive on the name extension', () => {
		expect(detectExtensionMismatch('PHOTO.JPG', '.jpg').mismatch).toBe(false);
		expect(detectExtensionMismatch('PHOTO.JPG', '.png').mismatch).toBe(true);
	});

	it('never flags when the sniffed type is unknown (null/undefined)', () => {
		expect(detectExtensionMismatch('mystery.jpg', null).mismatch).toBe(false);
		expect(detectExtensionMismatch('mystery.jpg', undefined).mismatch).toBe(false);
	});

	it('handles an extensionless name (no false positive)', () => {
		const r = detectExtensionMismatch('README', '.png');
		expect(r.fileExtension).toBeUndefined();
		// An extensionless name does not equal `.png`, so it is technically a mismatch we can offer to fix.
		expect(r.mismatch).toBe(true);
	});
});

describe('detectExtensionFromMagic (Item 12, sniff table)', () => {
	const dir = path.join(tmpdir(), `media-manager-sniff-test-${Date.now()}`);

	const SAMPLES: { name: string; bytes: number[]; ext: string }[] = [
		{ name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: '.png' },
		{ name: 'jpg', bytes: [0xff, 0xd8, 0xff, 0xe0], ext: '.jpg' },
		{ name: 'gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], ext: '.gif' },
		{ name: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00, 0x08], ext: '.tif' },
		{ name: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a, 0x00], ext: '.tif' },
		{ name: 'bmp', bytes: [0x42, 0x4d, 0x10, 0x00], ext: '.bmp' }
	];

	beforeAll(async () => {
		await fs.mkdir(dir, { recursive: true });
		for (const s of SAMPLES) {
			await fs.writeFile(path.join(dir, s.name), Buffer.from([...s.bytes, 0, 0, 0, 0, 0, 0, 0, 0]));
		}
		await fs.writeFile(path.join(dir, 'plain'), Buffer.from('just some text content', 'ascii'));
	});

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	for (const s of SAMPLES) {
		it(`detects ${s.name} as ${s.ext}`, async () => {
			expect(await detectExtensionFromMagic(path.join(dir, s.name))).toBe(s.ext);
		});
	}

	it('returns null for an unrecognised type', async () => {
		expect(await detectExtensionFromMagic(path.join(dir, 'plain'))).toBeNull();
	});
});

describe('readImageFileMetadata for PDFs', () => {
	const dir = path.join(tmpdir(), `media-manager-pdf-test-${Date.now()}`);
	const filename = 'sample.pdf';

	beforeAll(async () => {
		await fs.mkdir(dir, { recursive: true });
		const filePath = path.join(dir, filename);
		await fs.writeFile(filePath, buildMinimalPdf());
		// Use exiftool itself to set document properties, then read them back through our code.
		await exiftool.write(
			filePath,
			{ Title: 'My Title', Author: 'Jane Doe', Subject: 'Testing PDFs' },
			['-overwrite_original']
		);
	});

	afterAll(async () => {
		await exiftool.end();
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('returns document metadata in the shared shape', async () => {
		const meta = (await readImageFileMetadata(dir, filename)) as Record<string, unknown>;

		expect(meta.format).toBe('pdf');
		expect(meta.pageCount).toBe(1);
		expect(meta.title).toBe('My Title');
		expect(meta.author).toBe('Jane Doe');
		expect(meta.subject).toBe('Testing PDFs');
		expect(meta.filename).toBe(filename);
		expect(typeof meta.fileSizeFormatted).toBe('string');
		expect(meta.exif).toBeTruthy();

		// Image-only fields are not applicable to PDFs.
		expect(meta.width).toBeUndefined();
		expect(meta.height).toBeUndefined();
		expect(meta.aspectRatio).toBeNull();
	});

	it('does not report pixel dimensions for PDFs', async () => {
		const dims = await readImageDimensions(path.join(dir, filename));
		expect(dims).toEqual({ width: undefined, height: undefined });
	});
});
