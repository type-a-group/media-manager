/**
 * A small, fluent, read-only collection wrapper returned by every list-returning facade method
 * (`mm.media()`, `mm.records()`, `MediaItem.files()`). It is deliberately **not** a query DSL — just
 * five chainable helpers plus iterability — so a host developer can do the 90% case
 * (`.where(...).sortBy(...)`) without learning an API, and drop straight into a Svelte `{#each}`.
 *
 * Filtering/sorting read item values through the item's own `field(key)` accessor (see
 * {@link FieldAccessible}), so `where`/`sortBy` work uniformly over both `MediaItem` and `MMRecord`
 * and look in the same place `field()` does (schema fields first, then intrinsics like `width`).
 */

/** Anything a {@link Collection} can filter/sort: it exposes a single value accessor by key. */
export interface FieldAccessible {
	/** Resolve a value by key for filtering/sorting (fields first, then intrinsic props). */
	field(key: string): unknown;
}

/** Structural equality good enough for `where`: identity for scalars, element-wise for arrays. */
function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
	}
	return false;
}

/**
 * An ordered, immutable view over a list of items. Every method returns either a new `Collection`
 * (so chains never mutate) or, for `map`, a plain array (you're projecting out of the collection
 * into your own shape). Iterable, with `.length` and `.all` for direct use in templates.
 *
 * @typeParam T - The item type; must expose a `field(key)` accessor.
 */
export class Collection<T extends FieldAccessible> implements Iterable<T> {
	private readonly items: T[];

	constructor(items: T[]) {
		this.items = items;
	}

	/** Number of items. */
	get length(): number {
		return this.items.length;
	}

	/** A defensive copy of the underlying items as a plain array. */
	get all(): T[] {
		return this.items.slice();
	}

	[Symbol.iterator](): Iterator<T> {
		return this.items[Symbol.iterator]();
	}

	/** A plain-array copy — alias of {@link all} for callers who prefer a method. */
	toArray(): T[] {
		return this.items.slice();
	}

	/** The first item, or `undefined` when empty. */
	first(): T | undefined {
		return this.items[0];
	}

	/** The first item matching `predicate`, or `undefined`. */
	find(predicate: (item: T, index: number) => boolean): T | undefined {
		return this.items.find(predicate);
	}

	/** A new Collection of the items matching `predicate`. */
	filter(predicate: (item: T, index: number) => boolean): Collection<T> {
		return new Collection(this.items.filter(predicate));
	}

	/** Project each item to a new shape. Returns a **plain array** (you're leaving the collection). */
	map<U>(fn: (item: T, index: number) => U): U[] {
		return this.items.map(fn);
	}

	/**
	 * Filter by field equality. Two forms:
	 * - `where({ hidden: false, Year: '2024' })` — every key/value must match (AND).
	 * - `where('Year', '2024')` — a single field equals a value.
	 *
	 * Values are compared with structural equality (scalars by identity, arrays element-wise),
	 * reading each item's value through its `field()` accessor.
	 *
	 * @returns A new filtered Collection.
	 */
	where(criteria: Record<string, unknown>): Collection<T>;
	where(key: string, value: unknown): Collection<T>;
	where(keyOrCriteria: string | Record<string, unknown>, value?: unknown): Collection<T> {
		const entries: [string, unknown][] =
			typeof keyOrCriteria === 'string' ? [[keyOrCriteria, value]] : Object.entries(keyOrCriteria);
		return new Collection(
			this.items.filter((item) => entries.every(([k, v]) => valuesEqual(item.field(k), v)))
		);
	}

	/**
	 * Sort by a field. Nullish values sort last regardless of direction. Comparison uses `<`/`>` so
	 * it works for strings and numbers; mixed/object values fall back to stable order.
	 *
	 * @param key - The field key to sort on.
	 * @param dir - `'asc'` (default) or `'desc'`.
	 * @returns A new sorted Collection.
	 */
	sortBy(key: string, dir: 'asc' | 'desc' = 'asc'): Collection<T> {
		const sign = dir === 'desc' ? -1 : 1;
		const sorted = this.items.slice().sort((a, b) => {
			const av = a.field(key);
			const bv = b.field(key);
			const aNull = av == null || av === '';
			const bNull = bv == null || bv === '';
			if (aNull && bNull) return 0;
			if (aNull) return 1;
			if (bNull) return -1;
			if (av! < bv!) return -1 * sign;
			if (av! > bv!) return 1 * sign;
			return 0;
		});
		return new Collection(sorted);
	}
}
