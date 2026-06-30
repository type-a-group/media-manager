import { describe, it, expect } from 'vitest';
import {
	isEmptyValue,
	recordHasEmptyField,
	getOperatorsForFieldType,
	OPERATORS,
	DATE_OPERATORS
} from './filters.js';

describe('getOperatorsForFieldType — date', () => {
	it('offers the date-aware comparison operators (on/before/after + empty)', () => {
		expect(getOperatorsForFieldType('date')).toEqual(DATE_OPERATORS);
		expect(getOperatorsForFieldType('date')).toEqual([
			OPERATORS.equals,
			OPERATORS.less_than,
			OPERATORS.less_than_or_equal,
			OPERATORS.greater_than,
			OPERATORS.greater_than_or_equal,
			OPERATORS.is_empty,
			OPERATORS.is_not_empty
		]);
	});

	it('defaults (first operator) to equals ("on")', () => {
		expect(getOperatorsForFieldType('date')[0]).toBe(OPERATORS.equals);
	});
});

describe('isEmptyValue — the single empty predicate', () => {
	it('treats empty string / null / undefined as empty', () => {
		expect(isEmptyValue('')).toBe(true);
		expect(isEmptyValue(null)).toBe(true);
		expect(isEmptyValue(undefined)).toBe(true);
	});

	it('treats an empty list as empty, a non-empty list as filled', () => {
		expect(isEmptyValue([])).toBe(true);
		expect(isEmptyValue(['a'])).toBe(false);
		expect(isEmptyValue([''])).toBe(false); // a list with one (blank) item is still non-empty
	});

	it('treats a url value object as empty only when its url is blank', () => {
		expect(isEmptyValue({ display_name: 'site', url: '' })).toBe(true);
		expect(isEmptyValue({ display_name: '', url: '   ' })).toBe(true); // whitespace-only url
		expect(isEmptyValue({ display_name: 'site', url: 'https://x' })).toBe(false);
	});

	it('treats string / number / boolean values as filled', () => {
		expect(isEmptyValue('hello')).toBe(false);
		expect(isEmptyValue(' ')).toBe(false); // a non-empty (space) string is filled — matches is_empty behaviour
		expect(isEmptyValue(0)).toBe(false); // zero is a value, not empty
		expect(isEmptyValue(42)).toBe(false);
		expect(isEmptyValue(false)).toBe(false); // false is a value, not empty
		expect(isEmptyValue(true)).toBe(false);
	});

	it('a file-type value (a manifest id string) is filled', () => {
		expect(isEmptyValue('a1b2c3-id')).toBe(false);
	});
});

describe('recordHasEmptyField — the incomplete predicate', () => {
	const rec = {
		name: 'Report',
		priority: 0, // a value, not empty
		status: '', // empty
		tags: [], // empty
		link: { display_name: 'x', url: 'https://x' } // filled
	};

	it('is true when at least one of the given keys is empty', () => {
		expect(recordHasEmptyField(rec, ['name', 'status'])).toBe(true); // status empty
		expect(recordHasEmptyField(rec, ['tags'])).toBe(true); // empty list
	});

	it('is false when every given key is filled', () => {
		expect(recordHasEmptyField(rec, ['name', 'priority', 'link'])).toBe(false);
	});

	it('treats a missing key as empty', () => {
		expect(recordHasEmptyField(rec, ['nonexistent'])).toBe(true);
	});

	it('is false for an empty key set (nothing to be incomplete about)', () => {
		expect(recordHasEmptyField(rec, [])).toBe(false);
	});
});
