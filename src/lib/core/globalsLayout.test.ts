import { describe, it, expect } from 'vitest';
import {
	parseLayout,
	reconcileLayout,
	orderedFields,
	DEFAULT_SECTION_NAME,
	type GlobalsLayout
} from './globalsLayout.js';

describe('parseLayout', () => {
	it('returns null for non-strings and malformed JSON', () => {
		expect(parseLayout(undefined)).toBeNull();
		expect(parseLayout(42)).toBeNull();
		expect(parseLayout('{not json')).toBeNull();
		expect(parseLayout('"a string"')).toBeNull();
		expect(parseLayout('{}')).toBeNull(); // no sections array
	});

	it('decodes a well-formed layout and coerces section fields', () => {
		const raw = JSON.stringify({
			sections: [{ id: 'sec_a', name: 'A', collapsed: true, fields: ['x', 1, 'y'] }],
			defaultSectionId: 'sec_a',
			fieldSort: 'alpha'
		});
		const layout = parseLayout(raw)!;
		expect(layout.sections).toHaveLength(1);
		expect(layout.sections[0]).toEqual({
			id: 'sec_a',
			name: 'A',
			collapsed: true,
			fields: ['x', 'y'] // the numeric entry is filtered out
		});
		expect(layout.defaultSectionId).toBe('sec_a');
		expect(layout.fieldSort).toBe('alpha');
	});

	it('skips sections missing an id and defaults fieldSort to manual', () => {
		const raw = JSON.stringify({
			sections: [
				{ name: 'no id', fields: ['x'] },
				{ id: 'sec_b', name: 'B', fields: [] }
			]
		});
		const layout = parseLayout(raw)!;
		expect(layout.sections.map((s) => s.id)).toEqual(['sec_b']);
		expect(layout.fieldSort).toBe('manual');
	});
});

describe('reconcileLayout', () => {
	it('synthesizes a single default section when there is no layout', () => {
		const out = reconcileLayout(null, ['a', 'b', 'c']);
		expect(out.sections).toHaveLength(1);
		expect(out.sections[0].name).toBe(DEFAULT_SECTION_NAME);
		expect(out.sections[0].fields).toEqual(['a', 'b', 'c']);
		expect(out.defaultSectionId).toBe(out.sections[0].id);
	});

	it('synthesizes a default section when sections is empty (zero sections → General)', () => {
		const layout: GlobalsLayout = { sections: [], defaultSectionId: '', fieldSort: 'alpha' };
		const out = reconcileLayout(layout, ['a']);
		expect(out.sections).toHaveLength(1);
		expect(out.sections[0].name).toBe(DEFAULT_SECTION_NAME);
		expect(out.sections[0].fields).toEqual(['a']);
		expect(out.fieldSort).toBe('alpha'); // preserved from input
	});

	it('drops stale field references that no longer exist on the record', () => {
		const layout: GlobalsLayout = {
			sections: [{ id: 'sec_a', name: 'A', collapsed: false, fields: ['a', 'gone', 'b'] }],
			defaultSectionId: 'sec_a',
			fieldSort: 'manual'
		};
		const out = reconcileLayout(layout, ['a', 'b']);
		expect(out.sections[0].fields).toEqual(['a', 'b']);
	});

	it('appends orphan keys to the default section in record order', () => {
		const layout: GlobalsLayout = {
			sections: [
				{ id: 'sec_a', name: 'A', collapsed: false, fields: ['a'] },
				{ id: 'sec_b', name: 'B', collapsed: false, fields: [] }
			],
			defaultSectionId: 'sec_b',
			fieldSort: 'manual'
		};
		const out = reconcileLayout(layout, ['a', 'x', 'y']);
		expect(out.sections.find((s) => s.id === 'sec_a')!.fields).toEqual(['a']);
		expect(out.sections.find((s) => s.id === 'sec_b')!.fields).toEqual(['x', 'y']);
	});

	it('falls back to the first section for orphans when defaultSectionId dangles', () => {
		const layout: GlobalsLayout = {
			sections: [{ id: 'sec_a', name: 'A', collapsed: false, fields: [] }],
			defaultSectionId: 'sec_missing',
			fieldSort: 'manual'
		};
		const out = reconcileLayout(layout, ['x']);
		expect(out.defaultSectionId).toBe('sec_a');
		expect(out.sections[0].fields).toEqual(['x']);
	});

	it('de-dupes a key appearing in two sections, keeping the first', () => {
		const layout: GlobalsLayout = {
			sections: [
				{ id: 'sec_a', name: 'A', collapsed: false, fields: ['dup'] },
				{ id: 'sec_b', name: 'B', collapsed: false, fields: ['dup', 'b'] }
			],
			defaultSectionId: 'sec_a',
			fieldSort: 'manual'
		};
		const out = reconcileLayout(layout, ['dup', 'b']);
		expect(out.sections.find((s) => s.id === 'sec_a')!.fields).toEqual(['dup']);
		expect(out.sections.find((s) => s.id === 'sec_b')!.fields).toEqual(['b']);
	});

	it('preserves empty sections and does not mutate the input', () => {
		const layout: GlobalsLayout = {
			sections: [
				{ id: 'sec_a', name: 'A', collapsed: false, fields: ['a'] },
				{ id: 'sec_empty', name: 'Empty', collapsed: true, fields: [] }
			],
			defaultSectionId: 'sec_a',
			fieldSort: 'manual'
		};
		const snapshot = JSON.stringify(layout);
		const out = reconcileLayout(layout, ['a']);
		expect(out.sections.map((s) => s.id)).toEqual(['sec_a', 'sec_empty']);
		expect(JSON.stringify(layout)).toBe(snapshot); // input untouched
	});
});

describe('orderedFields', () => {
	it('manual is identity', () => {
		expect(orderedFields(['b', 'a', 'c'], 'manual')).toEqual(['b', 'a', 'c']);
	});
	it('alpha sorts case-insensitively without mutating input', () => {
		const input = ['Banana', 'apple', 'Cherry'];
		expect(orderedFields(input, 'alpha')).toEqual(['apple', 'Banana', 'Cherry']);
		expect(input).toEqual(['Banana', 'apple', 'Cherry']);
	});
});
