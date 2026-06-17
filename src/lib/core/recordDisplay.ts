import type { JsonListItem } from './types.js';

/**
 * Resolve the display title for a record list row in the Records Explorer.
 *
 * Records types don't always have a `name` field; before this resolver such rows fell back to the
 * raw id (e.g. `55555555`). Resolution order: explicit `name` → the chosen `title_value` (populated
 * when the list was requested with a `titleField`) → the `group_by_value` (when grouped) → a short
 * id as a last resort. Pure and side-effect-free so it can be unit-tested and shared by the row list
 * and the detail-pane header.
 *
 * @param item - A record list item from `apiListRecordsForType`.
 * @returns A non-empty human-readable title.
 */
export function recordListTitle(item: JsonListItem): string {
	const name = item.name?.trim();
	if (name) return name;
	const title = item.title_value?.trim();
	if (title) return title;
	const g = item.group_by_value;
	if (g != null && g !== '') return Array.isArray(g) ? g.join(', ') : String(g);
	return item.id.slice(0, 8);
}

/**
 * Resolve the display title for the detail pane from a loaded record + the field used for titling.
 * Mirrors {@link recordListTitle} but works against a full record object (the detail pane has every
 * field, not just the list projection).
 *
 * @param record - The full record (or null while loading).
 * @param id - The record id (fallback).
 * @param titleField - The schema field currently chosen to title records (optional).
 */
export function recordDetailTitle(
	record: Record<string, unknown> | null,
	id: string,
	titleField?: string | null
): string {
	const name = typeof record?.name === 'string' ? record.name.trim() : '';
	if (name) return name;
	if (titleField && titleField !== 'name' && record) {
		const v = record[titleField];
		if (typeof v === 'string' && v.trim()) return v.trim();
		if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	}
	return id.slice(0, 8);
}
