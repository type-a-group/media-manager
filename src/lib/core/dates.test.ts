import { describe, it, expect } from 'vitest';
import { isValidIsoDate, formatDateMedium, isoToday } from './dates.js';

describe('isValidIsoDate', () => {
	it('accepts real date-only ISO strings', () => {
		expect(isValidIsoDate('2026-06-29')).toBe(true);
		expect(isValidIsoDate('2000-01-01')).toBe(true);
		expect(isValidIsoDate('2024-02-29')).toBe(true); // leap year
	});

	it('rejects malformed shapes', () => {
		expect(isValidIsoDate('2026-6-29')).toBe(false); // not zero-padded
		expect(isValidIsoDate('2026/06/29')).toBe(false);
		expect(isValidIsoDate('2026-06-29T00:00:00')).toBe(false); // has time
		expect(isValidIsoDate('29-06-2026')).toBe(false);
		expect(isValidIsoDate('')).toBe(false);
	});

	it('rejects out-of-range months and impossible days', () => {
		expect(isValidIsoDate('2026-13-01')).toBe(false);
		expect(isValidIsoDate('2026-00-10')).toBe(false);
		expect(isValidIsoDate('2026-02-30')).toBe(false);
		expect(isValidIsoDate('2025-02-29')).toBe(false); // not a leap year
		expect(isValidIsoDate('2026-04-31')).toBe(false); // April has 30 days
	});

	it('rejects non-strings', () => {
		expect(isValidIsoDate(20260629)).toBe(false);
		expect(isValidIsoDate(null)).toBe(false);
		expect(isValidIsoDate(undefined)).toBe(false);
		expect(isValidIsoDate({})).toBe(false);
	});
});

describe('formatDateMedium', () => {
	it('renders the deterministic DD Mon YYYY form', () => {
		expect(formatDateMedium('2026-06-29')).toBe('29 Jun 2026');
		expect(formatDateMedium('2019-01-02')).toBe('02 Jan 2019');
		expect(formatDateMedium('2020-12-31')).toBe('31 Dec 2020');
	});

	it('returns empty string for invalid/empty input', () => {
		expect(formatDateMedium('')).toBe('');
		expect(formatDateMedium('not-a-date')).toBe('');
		expect(formatDateMedium('2026-02-30')).toBe('');
		expect(formatDateMedium(null)).toBe('');
	});
});

describe('isoToday', () => {
	it('returns a string that is itself a valid date-only ISO', () => {
		const t = isoToday();
		expect(isValidIsoDate(t)).toBe(true);
	});
});
