/**
 * Shared, side-agnostic sort comparator for every list view (Files hub · single-class catalog ·
 * Records). The server read layer (`classRepo.listAllFiles` / `listClassMembers`, `jsonRepo.listRecords`)
 * applies this so sorting composes with the existing server-side search + filter rather than being
 * re-done on the client. Client+server safe — no Node imports.
 *
 * Design (1.0, Item 9):
 * - **Empties always last.** A null / undefined / `""` / empty-array value sorts to the *end* in BOTH
 *   directions, so incomplete rows never crowd the top of an ascending sort.
 * - **Stable tie-break by id.** Equal keys keep a deterministic, direction-independent order across
 *   reloads (the manifest/record id).
 * - **Type-aware compare.** Numbers compare numerically, ISO date strings (`last_modified`,
 *   `created_at`) compare lexicographically (correct for ISO-8601), everything else compares as a
 *   case-insensitive string.
 *
 * @see docs/plans/v1.0/09-sorting-plan.html — §4 (semantics), §7.
 */

import type { SchemaDefinition } from './types.js';
import { stringifyFieldValue, type RecordRefRenderer } from './recordDisplay.js';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

/** A raw value handed to the comparator before normalization. */
export type RawSortValue = string | number | boolean | string[] | null | undefined;

/** Sentinel for "empty" — sorts last in both directions, regardless of {@link SortDir}. */
const EMPTY = Symbol('empty-sort-value');
type Normalized = string | number | typeof EMPTY;

/**
 * Normalize a raw value into a comparable primitive, collapsing every "empty" shape to {@link EMPTY}.
 * Strings are trimmed + lowercased so the compare is case-insensitive; booleans become 0/1; arrays
 * join to their text (empty array ⇒ EMPTY).
 */
function normalize(v: RawSortValue): Normalized {
	if (v === null || v === undefined) return EMPTY;
	if (typeof v === 'number') return Number.isNaN(v) ? EMPTY : v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (Array.isArray(v)) {
		const joined = v.join(', ').trim().toLowerCase();
		return joined === '' ? EMPTY : joined;
	}
	const s = v.trim().toLowerCase();
	return s === '' ? EMPTY : s;
}

/**
 * Compare two already-normalized, non-empty values. Numbers numerically; otherwise a locale-aware,
 * case-insensitive string compare (ISO date strings order correctly under this).
 */
function compareNonEmpty(
	a: Exclude<Normalized, typeof EMPTY>,
	b: Exclude<Normalized, typeof EMPTY>
): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b));
}

/** How to read the sort key + a stable id off each item. */
export interface SortAccessors<T> {
	/** Raw sortable value for the chosen field; return null/undefined/'' for "empty". */
	value: (item: T) => RawSortValue;
	/** Stable, direction-independent tie-break id (manifest/record id). */
	id: (item: T) => string;
}

/**
 * Sort `items` by a single key + direction, with empties-last and an id tie-break. Pure (returns a
 * new array; does not mutate the input). The caller supplies the per-shape value/id accessors, so one
 * comparator serves `FileItem`, `JsonListItem`, and raw record arrays.
 *
 * @param items - The rows to sort.
 * @param dir - Ascending or descending (only affects ordering between non-empty values).
 * @param acc - How to read the sort value + id off each row.
 * @returns A new, sorted array.
 *
 * Concerns / future improvements:
 * - Single key only (no user-chosen secondary key) — secondary order is the id tie-break. Multi-key
 *   sort is an explicit 1.0 cut-line (see the plan).
 */
export function sortItems<T>(items: T[], dir: SortDir, acc: SortAccessors<T>): T[] {
	const decorated = items.map((item) => ({
		item,
		key: normalize(acc.value(item)),
		id: acc.id(item)
	}));
	decorated.sort((x, y) => {
		const xEmpty = x.key === EMPTY;
		const yEmpty = y.key === EMPTY;
		if (xEmpty || yEmpty) {
			if (xEmpty && yEmpty) return x.id.localeCompare(y.id); // both empty ⇒ stable by id
			return xEmpty ? 1 : -1; // the empty one goes last, in either direction
		}
		// Both non-empty here (the guard above returned for any EMPTY), so the symbol is excluded.
		let c = compareNonEmpty(
			x.key as Exclude<Normalized, typeof EMPTY>,
			y.key as Exclude<Normalized, typeof EMPTY>
		);
		if (dir === 'desc') c = -c;
		if (c !== 0) return c;
		return x.id.localeCompare(y.id); // tie-break is always ascending-by-id (direction-independent)
	});
	return decorated.map((d) => d.item);
}

/**
 * Extract a comparable value for a user **schema field** from a record, preserving native numeric /
 * boolean ordering and reusing {@link stringifyFieldValue} for url/list/dropdown text. Empty ⇒ null
 * (which {@link sortItems} sorts last).
 *
 * @param schema - The owning schema (class or type).
 * @param key - The schema field key.
 * @param val - The raw stored value (`rec[key]`).
 */
export function fieldSortValue(
	schema: SchemaDefinition,
	key: string,
	val: unknown,
	resolveRef?: RecordRefRenderer
): RawSortValue {
	if (val === null || val === undefined) return null;
	const def = schema[key];
	if (def?.type === 'number') {
		const n = typeof val === 'number' ? val : Number(val);
		return Number.isNaN(n) ? null : n;
	}
	if (def?.type === 'boolean') return typeof val === 'boolean' ? val : null;
	return stringifyFieldValue(schema, key, val, resolveRef) ?? null;
}

/**
 * Resolve a requested (field, dir) pair from query params against a per-surface fallback. An unknown
 * or empty field falls back to the surface default; an invalid direction falls back to the default
 * direction. Keeps every list endpoint's param handling identical.
 *
 * @param field - Raw `?sort` param (may be null/empty).
 * @param dir - Raw `?dir` param (may be null/empty).
 * @param allowed - The set of sort keys this surface offers (built-ins + schema field keys).
 * @param fallback - The surface default applied when `field` is missing/unknown.
 */
export function resolveSort(
	field: string | null | undefined,
	dir: string | null | undefined,
	allowed: Iterable<string>,
	fallback: { field: string; dir: SortDir }
): { field: string; dir: SortDir } {
	const allow = allowed instanceof Set ? allowed : new Set(allowed);
	const f = field && allow.has(field) ? field : fallback.field;
	const d: SortDir = dir === 'asc' || dir === 'desc' ? dir : fallback.dir;
	return { field: f, dir: d };
}
