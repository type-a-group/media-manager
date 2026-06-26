import { describe, it, expect } from 'vitest';
import { sortItems, fieldSortValue, resolveSort } from './sort.js';
import type { SchemaDefinition } from './types.js';

/** A tiny row shape for comparator tests: a value + a stable id. */
type Row = { id: string; v: unknown };
const rows = (...vs: [string, unknown][]): Row[] => vs.map(([id, v]) => ({ id, v }));
const order = (items: Row[], dir: 'asc' | 'desc') =>
	sortItems(items, dir, { value: (r) => r.v as never, id: (r) => r.id }).map((r) => r.id);

describe('sortItems — strings', () => {
	it('sorts case-insensitively ascending', () => {
		expect(order(rows(['a', 'banana'], ['b', 'Apple'], ['c', 'cherry']), 'asc')).toEqual([
			'b',
			'a',
			'c'
		]);
	});
	it('reverses for descending', () => {
		expect(order(rows(['a', 'banana'], ['b', 'Apple'], ['c', 'cherry']), 'desc')).toEqual([
			'c',
			'a',
			'b'
		]);
	});
});

describe('sortItems — numbers', () => {
	it('compares numerically, not lexically', () => {
		expect(order(rows(['a', 2], ['b', 10], ['c', 1]), 'asc')).toEqual(['c', 'a', 'b']);
		expect(order(rows(['a', 2], ['b', 10], ['c', 1]), 'desc')).toEqual(['b', 'a', 'c']);
	});
});

describe('sortItems — ISO dates (string compare)', () => {
	it('orders ISO timestamps chronologically', () => {
		const items = rows(
			['old', '2024-01-01T00:00:00.000Z'],
			['new', '2026-06-26T12:00:00.000Z'],
			['mid', '2025-03-15T08:30:00.000Z']
		);
		expect(order(items, 'desc')).toEqual(['new', 'mid', 'old']);
		expect(order(items, 'asc')).toEqual(['old', 'mid', 'new']);
	});
});

describe('sortItems — booleans', () => {
	it('false < true ascending', () => {
		expect(order(rows(['t', true], ['f', false]), 'asc')).toEqual(['f', 't']);
		expect(order(rows(['t', true], ['f', false]), 'desc')).toEqual(['t', 'f']);
	});
});

describe('sortItems — empties always last', () => {
	for (const dir of ['asc', 'desc'] as const) {
		it(`null / undefined / "" / [] sink to the end (${dir})`, () => {
			const items = rows(
				['has', 'value'],
				['null', null],
				['undef', undefined],
				['empty', ''],
				['blank', '   '],
				['arr', []]
			);
			const result = order(items, dir);
			expect(result[0]).toBe('has');
			// every empty id appears after the only non-empty one, regardless of direction
			expect(result.slice(1).sort()).toEqual(['arr', 'blank', 'empty', 'null', 'undef'].sort());
		});
	}
	it('all-empty rows fall back to stable id order', () => {
		expect(order(rows(['c', null], ['a', ''], ['b', undefined]), 'desc')).toEqual(['a', 'b', 'c']);
	});
});

describe('sortItems — stable id tie-break', () => {
	it('equal keys order by id ascending, independent of direction', () => {
		const items = rows(['c', 'same'], ['a', 'same'], ['b', 'same']);
		expect(order(items, 'asc')).toEqual(['a', 'b', 'c']);
		expect(order(items, 'desc')).toEqual(['a', 'b', 'c']);
	});
	it('does not mutate the input array', () => {
		const items = rows(['b', 2], ['a', 1]);
		const copy = [...items];
		sortItems(items, 'asc', { value: (r) => r.v as never, id: (r) => r.id });
		expect(items).toEqual(copy);
	});
});

describe('fieldSortValue — per field type', () => {
	const schema = {
		title: { type: 'string', removable: true },
		rating: { type: 'number', removable: true },
		done: { type: 'boolean', removable: true },
		tags: { type: 'list', itemType: 'string', removable: true },
		link: { type: 'url', removable: true },
		genre: { type: 'dropdown', multiselect: true, removable: true }
	} as unknown as SchemaDefinition;

	it('keeps numbers native for numeric ordering', () => {
		expect(fieldSortValue(schema, 'rating', 5)).toBe(5);
		expect(fieldSortValue(schema, 'rating', '7')).toBe(7);
		expect(fieldSortValue(schema, 'rating', 'nope')).toBeNull();
	});
	it('keeps booleans native', () => {
		expect(fieldSortValue(schema, 'done', true)).toBe(true);
		expect(fieldSortValue(schema, 'done', false)).toBe(false);
	});
	it('url sorts by display name (falling back to url)', () => {
		expect(fieldSortValue(schema, 'link', { display_name: 'Anthropic', url: 'https://x' })).toBe(
			'Anthropic'
		);
		expect(fieldSortValue(schema, 'link', { display_name: '', url: 'https://x' })).toBe(
			'https://x'
		);
	});
	it('list sorts by joined text', () => {
		expect(fieldSortValue(schema, 'tags', ['b', 'a'])).toBe('b, a');
	});
	it('multiselect dropdown joins values', () => {
		expect(fieldSortValue(schema, 'genre', ['rock', 'jazz'])).toBe('rock, jazz');
	});
	it('empty values become null', () => {
		expect(fieldSortValue(schema, 'title', null)).toBeNull();
		expect(fieldSortValue(schema, 'title', undefined)).toBeNull();
	});

	it('composes with sortItems for a number schema field', () => {
		const recs = [
			{ id: 'a', rating: 2 },
			{ id: 'b', rating: 10 },
			{ id: 'c', rating: undefined }
		];
		const sorted = sortItems(recs, 'desc', {
			value: (r) => fieldSortValue(schema, 'rating', r.rating),
			id: (r) => r.id
		}).map((r) => r.id);
		expect(sorted).toEqual(['b', 'a', 'c']); // 10, 2, then empty last
	});
});

describe('resolveSort', () => {
	const allowed = ['name', 'last_modified', 'rating'];
	const fallback = { field: 'last_modified', dir: 'desc' as const };

	it('passes through an allowed field + valid dir', () => {
		expect(resolveSort('rating', 'asc', allowed, fallback)).toEqual({
			field: 'rating',
			dir: 'asc'
		});
	});
	it('falls back on unknown field', () => {
		expect(resolveSort('bogus', 'asc', allowed, fallback)).toEqual({
			field: 'last_modified',
			dir: 'asc'
		});
	});
	it('falls back on missing field / dir', () => {
		expect(resolveSort(null, null, allowed, fallback)).toEqual(fallback);
		expect(resolveSort('name', 'sideways', allowed, fallback)).toEqual({
			field: 'name',
			dir: 'desc'
		});
	});
});
