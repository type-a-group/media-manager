import type { JsonListItem } from './types.js';

/**
 * Resolve the display title for a record list row in the Records Explorer.
 *
 * Records types don't always have a `name` field; before this resolver such rows fell back to the
 * raw id (e.g. `55555555`). The server now resolves an effective title field (the chosen "title by",
 * else a sensible default) and returns it as `title_value`, so we trust that FIRST — otherwise a type
 * with a `name` field would shadow the chosen title field. Resolution order: `title_value` → `name` →
 * the `group_by_value` (when grouped) → a short id as a last resort. Pure and side-effect-free so it
 * can be unit-tested and shared by the row list and the detail-pane header.
 *
 * @param item - A record list item from `apiListRecordsForType`.
 * @returns A non-empty human-readable title.
 */
export function recordListTitle(item: JsonListItem): string {
	const title = item.title_value?.trim();
	if (title) return title;
	const name = item.name?.trim();
	if (name) return name;
	const g = item.group_by_value;
	if (g != null && g !== '') return Array.isArray(g) ? g.join(', ') : String(g);
	return item.id.slice(0, 8);
}

/**
 * Resolve the optional muted subtitle for a record list row, derived server-side from the type's
 * persisted `subtitleField`. Returns null when no subtitle is configured or the record's value is
 * empty (single-line row). The configured subtitle is independent of grouping — group values live in
 * the list's group headers, not the row subtitle.
 *
 * @param item - A record list item from `apiListRecordsForType`.
 * @returns The subtitle string, or null when there is none.
 */
export function recordListSubtitle(item: JsonListItem): string | null {
	const s = item.subtitle_value?.trim();
	return s ? s : null;
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
