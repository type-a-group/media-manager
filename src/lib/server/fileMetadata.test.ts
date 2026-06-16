import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { exiftool } from 'exiftool-vendored';
import { readImageFileMetadata, readImageDimensions } from './fileMetadata.js';
import { supportsFileMetadata, hasAllowedFileExtension, isPdfFilename } from '../core/images.js';

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
	it('treats .pdf as a stored + metadata-capable type', () => {
		expect(hasAllowedFileExtension('doc.pdf')).toBe(true);
		expect(supportsFileMetadata('doc.pdf')).toBe(true);
		expect(isPdfFilename('doc.PDF')).toBe(true);
		expect(isPdfFilename('photo.jpg')).toBe(false);
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
