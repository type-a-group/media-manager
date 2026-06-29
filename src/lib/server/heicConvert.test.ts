import { describe, it, expect } from 'vitest';
import { isHeicMime, isHeicExtension, maybeConvertHeic } from './heicConvert.js';

describe('heicConvert detection', () => {
	it('recognises HEIC/HEIF mime types case-insensitively', () => {
		expect(isHeicMime('image/heic')).toBe(true);
		expect(isHeicMime('IMAGE/HEIF')).toBe(true);
		expect(isHeicMime('image/jpeg')).toBe(false);
		expect(isHeicMime('')).toBe(false);
	});

	it('recognises .heic/.heif extensions case-insensitively', () => {
		expect(isHeicExtension('photo.HEIC')).toBe(true);
		expect(isHeicExtension('photo.heif')).toBe(true);
		expect(isHeicExtension('photo.jpg')).toBe(false);
		expect(isHeicExtension('photo')).toBe(false);
	});
});

describe('maybeConvertHeic passthrough', () => {
	it('passes non-HEIC bytes through unchanged (no conversion, original filename)', async () => {
		const bytes = Buffer.from('not-an-image');
		const out = await maybeConvertHeic(bytes, 'doc.png', 'image/png');
		expect(out.converted).toBe(false);
		expect(out.filename).toBe('doc.png');
		expect(out.buffer).toBe(bytes);
	});

	it('does not treat an unknown mime + non-HEIC extension as HEIC', async () => {
		const bytes = Buffer.from('abc');
		const out = await maybeConvertHeic(bytes, 'clip.mp4', '');
		expect(out.converted).toBe(false);
		expect(out.filename).toBe('clip.mp4');
	});
});
