import { describe, it, expect } from 'vitest';
import {
	recordListTitle,
	recordDetailTitle,
	stringifyFieldValue,
	groupByDisplayValue,
	projectRecordRow,
	buildFieldValues,
	MAX_VERBOSE_FIELDS
} from './recordDisplay.js';
import type { JsonListItem, SchemaDefinition } from './types.js';

describe('recordListTitle', () => {
	it('prefers a non-empty name', () => {
		const item: JsonListItem = { id: 'abcdef123456', name: 'Welcome note' };
		expect(recordListTitle(item)).toBe('Welcome note');
	});

	it('falls back to title_value when name is absent/blank', () => {
		expect(recordListTitle({ id: 'abcdef123456', title_value: 'From field' })).toBe('From field');
		expect(recordListTitle({ id: 'abcdef123456', name: '  ', title_value: 'From field' })).toBe(
			'From field'
		);
	});

	it('falls back to group_by_value before the id', () => {
		expect(recordListTitle({ id: 'abcdef123456', group_by_value: 'High' })).toBe('High');
		expect(recordListTitle({ id: 'abcdef123456', group_by_value: ['a', 'b'] })).toBe('a, b');
	});

	it('uses a short id as the last resort (the bug this fixes)', () => {
		expect(recordListTitle({ id: '55555555-aaaa-bbbb-cccc' })).toBe('55555555');
	});
});

describe('recordDetailTitle', () => {
	it('prefers the record name', () => {
		expect(recordDetailTitle({ name: 'Hello' }, 'abcdef123456')).toBe('Hello');
	});

	it('uses the chosen title field when there is no name', () => {
		expect(recordDetailTitle({ title: 'My doc' }, 'abcdef123456', 'title')).toBe('My doc');
		expect(recordDetailTitle({ count: 7 }, 'abcdef123456', 'count')).toBe('7');
	});

	it('falls back to a short id', () => {
		expect(recordDetailTitle(null, '55555555-aaaa')).toBe('55555555');
		expect(recordDetailTitle({}, '55555555-aaaa', 'missing')).toBe('55555555');
	});
});

// The shared projection is the single source of truth for list-row display values: the server list
// endpoint (jsonRepo.listRecords) and the client's optimistic post-save row patch both use it, so an
// autosave reflects in the list without a refetch and renders identically to a full reload.
const schema: SchemaDefinition = {
	name: { type: 'string' },
	priority: { type: 'dropdown', options: ['Low', 'High'] },
	tags: { type: 'list', itemTypes: ['string'] },
	site: { type: 'url' },
	labels: { type: 'dropdown', options: ['a', 'b', 'c'], multiselect: true },
	count: { type: 'number' }
} as unknown as SchemaDefinition;

describe('stringifyFieldValue', () => {
	it('renders url by display name, else the url', () => {
		expect(stringifyFieldValue(schema, 'site', { display_name: 'Home', url: 'x' })).toBe('Home');
		expect(stringifyFieldValue(schema, 'site', { display_name: '', url: 'http://x' })).toBe(
			'http://x'
		);
	});

	it('joins list values', () => {
		expect(stringifyFieldValue(schema, 'tags', ['a', 'b'])).toBe('a, b');
	});

	it('returns undefined for nullish/empty', () => {
		expect(stringifyFieldValue(schema, 'name', null)).toBeUndefined();
		expect(stringifyFieldValue(schema, 'name', '')).toBeUndefined();
	});

	it('stringifies scalars', () => {
		expect(stringifyFieldValue(schema, 'count', 7)).toBe('7');
	});
});

describe('groupByDisplayValue', () => {
	it('passes scalars/arrays through untouched', () => {
		expect(groupByDisplayValue(schema, 'count', 3)).toBe(3);
		expect(groupByDisplayValue(schema, 'name', 'x')).toBe('x');
	});

	it('joins multiselect dropdown + list values to a string', () => {
		expect(groupByDisplayValue(schema, 'labels', ['a', 'c'])).toBe('a, c');
		expect(groupByDisplayValue(schema, 'tags', ['a', 'b'])).toBe('a, b');
	});
});

describe('buildFieldValues (verbose grid, Item 8)', () => {
	it('returns undefined when no fields are requested (compact rows)', () => {
		expect(buildFieldValues(schema, { name: 'x' }, undefined)).toBeUndefined();
		expect(buildFieldValues(schema, { name: 'x' }, [])).toBeUndefined();
	});

	it('inlines requested fields in order, empty ⇒ "" so rows align tile-to-tile', () => {
		const rec = { name: 'Task', count: 7, priority: '' };
		expect(buildFieldValues(schema, rec, ['name', 'priority', 'count'])).toEqual({
			name: 'Task',
			priority: '',
			count: '7'
		});
	});

	it('renders complex field types via stringifyFieldValue', () => {
		const rec = { site: { display_name: 'Home', url: 'x' }, tags: ['a', 'b'] };
		expect(buildFieldValues(schema, rec, ['site', 'tags'])).toEqual({ site: 'Home', tags: 'a, b' });
	});

	it('drops keys absent from the schema and clamps to the cap', () => {
		expect(buildFieldValues(schema, { name: 'x' }, ['name', 'nope'])).toEqual({ name: 'x' });
		const wide: SchemaDefinition = Object.fromEntries(
			Array.from({ length: 9 }, (_, i) => [`g${i}`, { type: 'string' }])
		) as unknown as SchemaDefinition;
		const rec = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`g${i}`, `v${i}`]));
		const keys = Object.keys(buildFieldValues(wide, rec, Object.keys(wide)) ?? {});
		expect(keys).toHaveLength(MAX_VERBOSE_FIELDS);
		expect(keys).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']);
	});
});

describe('projectRecordRow', () => {
	it('projects name/title/subtitle/group from the chosen fields', () => {
		const rec = { id: 'r1', name: 'Task', priority: 'High', count: 5 };
		const row = projectRecordRow(schema, rec, {
			titleField: 'name',
			subtitleField: 'priority',
			groupBy: 'count'
		});
		expect(row).toEqual({
			name: 'Task',
			title_value: 'Task',
			subtitle_value: 'High',
			group_by_value: 5
		});
	});

	it('omits an empty title and a subtitle that duplicates the title', () => {
		const rec = { id: 'r2', name: '', priority: 'Low' };
		const row = projectRecordRow(schema, rec, {
			titleField: 'priority',
			subtitleField: 'priority',
			groupBy: ''
		});
		// subtitle equals title field ⇒ skipped; no group requested
		expect(row).toEqual({ name: '', title_value: 'Low' });
	});
});
