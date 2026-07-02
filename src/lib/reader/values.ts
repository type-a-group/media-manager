/**
 * Read-side value normalization for the reader.
 *
 * Mirrors `src/lib/core/types.ts:normalizeUrlValue` (the editor's source of truth) but is
 * reimplemented here as plain TS so the reader pulls in **no runtime `zod`** — keeping it
 * dependency-light for the future standalone package (FUTURE_CHANGES Item 44). The logic is
 * intentionally identical; if the core normalization changes, update this in lockstep.
 *
 * @see src/lib/core/types.ts — normalizeUrlValue (source of truth).
 */

/** A `url`-type field value: a display label + the URL. Legacy plain strings normalize to this. */
export interface UrlValue {
	display_name: string;
	url: string;
}

/**
 * Normalize a `url`-type field value. Legacy data may store a bare string; treat it as url-only
 * with an empty display name. A `{ url, display_name? }` object is normalized; anything else yields
 * an empty UrlValue.
 *
 * @param value - The raw stored value.
 * @returns A normalized {@link UrlValue}.
 */
export function normalizeUrlValue(value: unknown): UrlValue {
	if (
		value != null &&
		typeof value === 'object' &&
		'url' in value &&
		typeof (value as { url: unknown }).url === 'string'
	) {
		const o = value as Record<string, unknown>;
		return {
			display_name: typeof o.display_name === 'string' ? o.display_name : '',
			url: o.url as string
		};
	}
	if (typeof value === 'string') return { display_name: '', url: value };
	return { display_name: '', url: '' };
}

/**
 * The convenience normalization applied by `MediaItem.field()` / `MMRecord.field()`: a value that
 * looks like a `url` object is normalized to a {@link UrlValue}; everything else (scalars, lists,
 * file-id strings) passes through untouched. This keeps `.field()` predictable — it returns the
 * stored value — while smoothing the one shape (url) that has a legacy variant.
 *
 * @param value - The raw stored field value.
 * @returns The value, with url-shaped objects normalized.
 */
export function normalizeFieldValue(value: unknown): unknown {
	if (
		value != null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		'url' in value &&
		typeof (value as { url: unknown }).url === 'string'
	) {
		return normalizeUrlValue(value);
	}
	return value;
}
