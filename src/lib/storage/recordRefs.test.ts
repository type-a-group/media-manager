import { describe, it, expect } from 'vitest';
import {
	missingRecordFields,
	missingRecordsMap,
	recordRefRenderer,
	schemaHasRecordField,
	type RecordRefResolver
} from './recordRefs.js';
import type { SchemaDefinition } from '$lib/core/types.js';

const schema: SchemaDefinition = {
	author: { type: 'record', recordType: 'people', removable: true },
	tags: { type: 'record', recordType: 'topics', multiselect: true, removable: true },
	orphan: { type: 'record', removable: true }, // no recordType configured
	title: { type: 'string', removable: true }
};

/** A resolver with two known people (p1/p2 → Alice/Bob) and one topic (t1 → Tech). */
const resolver: RecordRefResolver = {
	available: new Map([
		['people', new Set(['p1', 'p2'])],
		['topics', new Set(['t1'])]
	]),
	titles: new Map([
		[
			'people',
			new Map([
				['p1', 'Alice'],
				['p2', 'Bob']
			])
		],
		['topics', new Map([['t1', 'Tech']])]
	])
};

describe('schemaHasRecordField', () => {
	it('detects record fields', () => {
		expect(schemaHasRecordField(schema)).toBe(true);
		expect(schemaHasRecordField({ title: { type: 'string', removable: true } })).toBe(false);
	});
});

describe('missingRecordFields', () => {
	it('returns nothing when every reference resolves', () => {
		expect(missingRecordFields({ author: 'p1', tags: ['t1'] }, schema, resolver)).toEqual([]);
	});

	it('flags a single field whose id is gone', () => {
		expect(missingRecordFields({ author: 'pX' }, schema, resolver)).toEqual(['author']);
	});

	it('flags a multiselect field when ANY id is gone', () => {
		expect(missingRecordFields({ tags: ['t1', 'tX'] }, schema, resolver)).toEqual(['tags']);
	});

	it('ignores empty values', () => {
		expect(missingRecordFields({ author: '', tags: [] }, schema, resolver)).toEqual([]);
	});

	it('flags a non-empty ref whose field has no configured recordType', () => {
		expect(missingRecordFields({ orphan: 'whatever' }, schema, resolver)).toEqual(['orphan']);
	});
});

describe('missingRecordsMap', () => {
	it('maps broken keys to short ids, or undefined when nothing is broken', () => {
		expect(missingRecordsMap({ author: 'p1' }, schema, resolver)).toBeUndefined();
		expect(missingRecordsMap({ author: 'pXXXXXXXXXX' }, schema, resolver)).toEqual({
			author: 'pXXXXXXX'
		});
	});
});

describe('recordRefRenderer', () => {
	const render = recordRefRenderer(schema, resolver);

	it('renders a single ref by its title', () => {
		expect(render('author', 'p1')).toBe('Alice');
	});

	it('joins multiselect refs by title', () => {
		expect(render('tags', ['t1'])).toBe('Tech');
	});

	it('falls back to a short id for an unresolved ref', () => {
		expect(render('author', 'pXXXXXXXXXX')).toBe('pXXXXXXX');
	});

	it('returns undefined for non-record fields and empty values', () => {
		expect(render('title', 'hello')).toBeUndefined();
		expect(render('author', '')).toBeUndefined();
	});
});
