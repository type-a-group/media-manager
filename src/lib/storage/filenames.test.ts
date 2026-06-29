import { describe, expect, it } from 'vitest';
import { assertSafeBasename, assertSafeImageFilename } from './filenames.js';

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

describe('assertSafeBasename', () => {
	it('accepts non-image basenames', () => {
		expect(assertSafeBasename('notes.txt')).toBe('notes.txt');
		expect(assertSafeBasename('data.json')).toBe('data.json');
	});

	it('rejects traversal', () => {
		expect(() => assertSafeBasename('../x')).toThrow();
		expect(() => assertSafeBasename('a/b')).toThrow();
	});
});
