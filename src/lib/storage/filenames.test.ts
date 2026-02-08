import { describe, expect, it } from 'vitest';
import { assertSafeImageFilename } from './filenames.js';

describe('assertSafeImageFilename', () => {
	it('accepts basenames with allowed extensions', () => {
		expect(assertSafeImageFilename('foo.jpg')).toBe('foo.jpg');
		expect(assertSafeImageFilename('bar.SVG')).toBe('bar.SVG');
	});

	it('rejects traversal and non-image extensions', () => {
		expect(() => assertSafeImageFilename('../foo.jpg')).toThrow();
		expect(() => assertSafeImageFilename('..\\foo.jpg')).toThrow();
		expect(() => assertSafeImageFilename('foo.exe')).toThrow();
	});
});

