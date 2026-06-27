import { describe, it, expect } from 'vitest';
import { orientationSwapsDimensions, orientationCorrectedDimensions } from './images.js';

describe('orientationSwapsDimensions', () => {
	it('returns false for non-rotating orientations (1–4)', () => {
		for (const o of [1, 2, 3, 4]) {
			expect(orientationSwapsDimensions(o)).toBe(false);
		}
	});

	it('returns true for quarter-turn orientations (5–8)', () => {
		for (const o of [5, 6, 7, 8]) {
			expect(orientationSwapsDimensions(o)).toBe(true);
		}
	});

	it('returns false for absent/unknown orientation', () => {
		expect(orientationSwapsDimensions(undefined)).toBe(false);
		expect(orientationSwapsDimensions(null)).toBe(false);
		expect(orientationSwapsDimensions(0)).toBe(false);
		expect(orientationSwapsDimensions(9)).toBe(false);
	});
});

describe('orientationCorrectedDimensions', () => {
	it('passes dimensions through unchanged for orientations 1–4', () => {
		for (const o of [1, 2, 3, 4]) {
			expect(orientationCorrectedDimensions(4000, 3000, o)).toEqual({ width: 4000, height: 3000 });
		}
	});

	it('transposes dimensions for quarter-turn orientations 5–8', () => {
		for (const o of [5, 6, 7, 8]) {
			expect(orientationCorrectedDimensions(4000, 3000, o)).toEqual({ width: 3000, height: 4000 });
		}
	});

	it('passes through when orientation is absent', () => {
		expect(orientationCorrectedDimensions(1200, 800, undefined)).toEqual({
			width: 1200,
			height: 800
		});
		expect(orientationCorrectedDimensions(1200, 800, null)).toEqual({ width: 1200, height: 800 });
	});

	it('is an involution for quarter turns (correcting twice restores the original)', () => {
		const once = orientationCorrectedDimensions(1200, 800, 6);
		const twice = orientationCorrectedDimensions(once.width, once.height, 6);
		expect(twice).toEqual({ width: 1200, height: 800 });
	});

	it('leaves square images unchanged regardless of orientation', () => {
		expect(orientationCorrectedDimensions(1000, 1000, 6)).toEqual({ width: 1000, height: 1000 });
	});
});
