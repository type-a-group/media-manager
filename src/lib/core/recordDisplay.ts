import { normalizeUrlValue, type JsonListItem, type SchemaDefinition } from './types.js';

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

/**
 * Render a single field value to a short, human-readable string for a record list row's title or
 * subtitle. `url` → display name (else the url); `list`/array → comma-joined (each `url` item by
 * display name, else url); everything else → `String(val)`. Returns `undefined` for nullish/empty so
 * callers can omit the field entirely.
 *
 * This is the **single source of truth** for list-row value rendering: `jsonRepo.listRecords` (server)
 * and the records host's optimistic in-place row patch both call it, so an autosave reflects in the
 * list without a refetch and renders identically to a full server reload. Pure + Node-free.
 *
 * @param schema - The record type's schema (for the field's `type`).
 * @param key - The field key to render.
 * @param val - The raw field value.
 */
export function stringifyFieldValue(
	schema: SchemaDefinition,
	key: string,
	val: unknown
): string | undefined {
	const def = schema[key];
	if (val == null) return undefined;
	if (def?.type === 'url') {
		const urlVal = normalizeUrlValue(val);
		return (urlVal.display_name ?? '').trim() || urlVal.url || undefined;
	}
	if (def?.type === 'list' && Array.isArray(val)) {
		return (
			val
				.map((v: unknown) =>
					v != null && typeof v === 'object' && 'url' in (v as object)
						? ((v as { display_name?: string; url?: string }).display_name ?? '').trim() ||
							(v as { url: string }).url ||
							''
						: String(v)
				)
				.join(', ') || undefined
		);
	}
	if (Array.isArray(val)) return (val as unknown[]).join(', ') || undefined;
	return String(val) || undefined;
}

/**
 * Maximum number of fields a verbose grid card may show (Item 8). The toolbar picker enforces this in
 * the UI; the list endpoints enforce it again defensively so a hand-crafted `?fields=` query can't
 * bloat every row. Kept here next to {@link buildFieldValues} so the cap has a single definition.
 */
export const MAX_VERBOSE_FIELDS = 6;

/**
 * Build the inline `field_values` map a verbose grid row carries (Item 8): the requested field keys →
 * their {@link stringifyFieldValue} rendering. This is the **load-bearing** shape that lets the grid
 * show several metadata fields per tile without a per-tile fetch — `jsonRepo.listRecords` and
 * `classRepo.listClassMembers` both call it so Files and Records render identical verbose cards.
 *
 * Order follows the requested `fields` (the user's picker order). Each requested key is kept even when
 * the value is empty (mapped to `''`) so the key/value rows line up tile-to-tile in the masonry — a
 * stable grid is the whole point of the Lightroom-style scan. Keys absent from the schema are dropped
 * (defensive against stale persisted field sets), and the list is clamped to {@link MAX_VERBOSE_FIELDS}.
 *
 * @param schema - The type/class schema (for each field's `type`).
 * @param rec - The raw record object.
 * @param fields - The requested field keys, in display order. Empty/nullish ⇒ returns `undefined` (no
 *   verbose payload at all, so the row stays compact).
 * @returns A `{ key: renderedValue }` map, or `undefined` when no fields were requested.
 */
export function buildFieldValues(
	schema: SchemaDefinition,
	rec: Record<string, unknown>,
	fields?: string[] | null
): Record<string, string> | undefined {
	if (!fields || fields.length === 0) return undefined;
	const keys = fields.filter((k) => schema[k]).slice(0, MAX_VERBOSE_FIELDS);
	if (keys.length === 0) return undefined;
	const out: Record<string, string> = {};
	for (const k of keys) out[k] = stringifyFieldValue(schema, k, rec[k]) ?? '';
	return out;
}

/**
 * Resolve a row's `group_by_value` for `field`. Scalars/arrays pass through unchanged (the grid groups
 * over the raw value); `url`/`list`/multiselect-`dropdown` are rendered to a string. Mirrors the server
 * group-by projection so an optimistic patch regroups a row exactly as a reload would. Returns
 * `undefined` only for value shapes that aren't groupable (caller leaves the field unset).
 */
export function groupByDisplayValue(
	schema: SchemaDefinition,
	field: string,
	val: unknown
): string | number | boolean | string[] | null | undefined {
	const def = schema[field];
	if (def?.type === 'url' && val != null) {
		const urlVal = normalizeUrlValue(val);
		return (urlVal.display_name ?? '').trim() || urlVal.url || '';
	}
	if (def?.type === 'list' && Array.isArray(val)) {
		return val
			.map((v: unknown) =>
				v != null && typeof v === 'object' && 'url' in (v as object)
					? ((v as { display_name?: string; url?: string }).display_name ?? '').trim() ||
						(v as { url: string }).url ||
						''
					: String(v)
			)
			.join(', ');
	}
	if (
		def?.type === 'dropdown' &&
		(def as { multiselect?: boolean }).multiselect &&
		Array.isArray(val)
	) {
		return (val as string[]).join(', ');
	}
	if (
		val === null ||
		typeof val === 'string' ||
		typeof val === 'number' ||
		typeof val === 'boolean' ||
		Array.isArray(val)
	) {
		return val as string | number | boolean | string[] | null;
	}
	return undefined;
}

/**
 * Project a full record into the display fields a Records list row renders — `name`, `title_value`,
 * `subtitle_value`, `group_by_value`. Pure and client/server-safe so the server list endpoint
 * (`jsonRepo.listRecords`) and the client's optimistic post-save row patch produce identical rows.
 *
 * Does NOT compute `missing_file_fields` (that needs the server's available-blob set) — callers add it
 * separately. `subtitle_value` is skipped when it would duplicate the title field.
 *
 * @param schema - The record type's schema.
 * @param record - The full record (raw on-disk field values).
 * @param opts - The active title/subtitle/group fields (each optional; empty ⇒ that field is omitted).
 */
export function projectRecordRow(
	schema: SchemaDefinition,
	record: Record<string, unknown>,
	opts: { titleField?: string | null; subtitleField?: string | null; groupBy?: string | null }
): Pick<JsonListItem, 'name' | 'title_value' | 'subtitle_value' | 'group_by_value'> {
	const out: Pick<JsonListItem, 'name' | 'title_value' | 'subtitle_value' | 'group_by_value'> = {};
	if (typeof record.name === 'string') out.name = record.name;
	const { titleField, subtitleField, groupBy } = opts;
	if (titleField) {
		const tv = stringifyFieldValue(schema, titleField, record[titleField]);
		if (tv !== undefined && tv !== '') out.title_value = tv;
	}
	if (subtitleField && subtitleField !== titleField) {
		const sv = stringifyFieldValue(schema, subtitleField, record[subtitleField]);
		if (sv !== undefined && sv !== '') out.subtitle_value = sv;
	}
	if (groupBy) {
		const gv = groupByDisplayValue(schema, groupBy, record[groupBy]);
		if (gv !== undefined) out.group_by_value = gv;
	}
	return out;
}
