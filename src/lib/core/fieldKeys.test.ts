import { describe, expect, it } from 'vitest';
import { schemaUserFieldKeys, schemaUserFields, reorderSchemaObject } from './fieldKeys.js';
import type { SchemaDefinition } from './types.js';

const schema = {
	zebra: { type: 'string' },
	name: { type: 'string' },
	apple: { type: 'number' },
	// reserved/system keys that must be excluded
	id: { type: 'string' },
	last_modified: { type: 'string' },
	width: { type: 'number' },
	height: { type: 'number' }
} as unknown as SchemaDefinition;

describe('schemaUserFieldKeys', () => {
	it('keeps user fields + name, drops reserved system keys', () => {
		const keys = schemaUserFieldKeys(schema);
		expect(keys).not.toContain('id');
		expect(keys).not.toContain('last_modified');
		expect(keys).not.toContain('width');
		expect(keys).not.toContain('height');
		expect(keys).toContain('name');
		expect(keys).toContain('apple');
		expect(keys).toContain('zebra');
	});

	it('floats name first, then preserves schema (manual) key order', () => {
		// `zebra` precedes `apple` in the object, so the manual order is kept (not alphabetised).
		expect(schemaUserFieldKeys(schema)).toEqual(['name', 'zebra', 'apple']);
	});

	it('returns [] for an empty schema', () => {
		expect(schemaUserFieldKeys({} as SchemaDefinition)).toEqual([]);
	});
});

describe('schemaUserFields', () => {
	it('maps to { key, label } in the same (manual) order', () => {
		expect(schemaUserFields(schema)).toEqual([
			{ key: 'name', label: 'Name' },
			{ key: 'zebra', label: 'Zebra' },
			{ key: 'apple', label: 'Apple' }
		]);
	});
});

describe('reorderSchemaObject', () => {
	const s = {
		a: { type: 'string' },
		b: { type: 'number' },
		c: { type: 'boolean' }
	} as unknown as SchemaDefinition;

	it('reorders keys to follow the given order', () => {
		expect(Object.keys(reorderSchemaObject(s, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
	});

	it('appends existing keys omitted from the order (preserving their relative order)', () => {
		// Only `c` is listed → it leads, then the untouched keys keep their original order.
		expect(Object.keys(reorderSchemaObject(s, ['c']))).toEqual(['c', 'a', 'b']);
	});

	it('ignores keys in the order that do not exist in the schema', () => {
		expect(Object.keys(reorderSchemaObject(s, ['ghost', 'b', 'a', 'c']))).toEqual(['b', 'a', 'c']);
	});

	it('tolerates duplicate keys in the order (first wins)', () => {
		expect(Object.keys(reorderSchemaObject(s, ['b', 'b', 'a']))).toEqual(['b', 'a', 'c']);
	});

	it('moves field definitions verbatim', () => {
		const out = reorderSchemaObject(s, ['c', 'b', 'a']);
		expect(out.a).toBe(s.a);
		expect(out.b).toBe(s.b);
		expect(out.c).toBe(s.c);
	});
});
