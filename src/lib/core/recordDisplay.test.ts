import { describe, it, expect } from 'vitest';
import { recordListTitle, recordDetailTitle } from './recordDisplay.js';
import type { JsonListItem } from './types.js';

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
