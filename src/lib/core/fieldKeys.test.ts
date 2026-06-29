import { describe, expect, it } from 'vitest';
import { schemaUserFieldKeys, schemaUserFields } from './fieldKeys.js';
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

	it('floats name first, then alphabetical', () => {
		expect(schemaUserFieldKeys(schema)).toEqual(['name', 'apple', 'zebra']);
	});

	it('returns [] for an empty schema', () => {
		expect(schemaUserFieldKeys({} as SchemaDefinition)).toEqual([]);
	});
});

describe('schemaUserFields', () => {
	it('maps to { key, label } in the same order', () => {
		expect(schemaUserFields(schema)).toEqual([
			{ key: 'name', label: 'Name' },
			{ key: 'apple', label: 'Apple' },
			{ key: 'zebra', label: 'Zebra' }
		]);
	});
});
