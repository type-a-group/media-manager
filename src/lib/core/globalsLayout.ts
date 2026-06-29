/**
 * Layout model for the Globals editor — the sectioned property-table grouping that rides alongside
 * the singleton globals record in the reserved `__layout` key (see `GLOBALS_LAYOUT_KEY` in
 * `fieldKeys.ts`). Globals has no schema, so just like `__field_kinds` (types) and `__field_meta`
 * (per-field options), the grouping/order/collapse state is persisted as a JSON-encoded reserved
 * record key rather than in `settings.json`. This module owns the shape and the load-time reconcile.
 *
 * Design notes:
 * - A **section's identity is its `id`** (e.g. `sec_ab12cd`), generated once; `name` is a rename-only
 *   display label, so renaming a section never re-keys field membership.
 * - `__layout` only owns grouping/order/collapse/sort — types stay in `__field_kinds`, options stay
 *   in `__field_meta`. There is no on-disk migration: a record with no `__layout` reconciles into a
 *   single default section.
 */

/** How fields are ordered within a section on render. `manual` honors the stored `fields[]` order. */
export type GlobalsFieldSort = 'manual' | 'alpha';

/** One collapsible group of fields in the Globals editor. */
export interface GlobalsSection {
	/** Stable generated id (`sec_…`); membership/`defaultSectionId` reference this, never `name`. */
	id: string;
	/** Display label, freely renamable. */
	name: string;
	/** Whether the section renders folded. */
	collapsed: boolean;
	/** Ordered field keys belonging to this section. */
	fields: string[];
}

/** The full `__layout` value (decoded). */
export interface GlobalsLayout {
	sections: GlobalsSection[];
	/** Section that receives newly-added fields (top-level "+ Add field"). */
	defaultSectionId: string;
	fieldSort: GlobalsFieldSort;
}

/** Display name used when reconcile has to synthesize a section for orphan/legacy fields. */
export const DEFAULT_SECTION_NAME = 'General';

/**
 * Mint a new section id. Short, url-safe, and collision-resistant enough for a single local record.
 *
 * @returns A `sec_`-prefixed id.
 */
export function nextSectionId(): string {
	const rand =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? (crypto as Crypto).randomUUID().replace(/-/g, '').slice(0, 10)
			: Math.random().toString(36).slice(2, 12);
	return `sec_${rand}`;
}

/**
 * Tolerantly decode the raw `__layout` record value (a JSON string) into a {@link GlobalsLayout}.
 * Returns `null` on anything malformed so callers fall through to {@link reconcileLayout}'s
 * synthesize-default path. This does NOT reconcile against the actual fields — call
 * {@link reconcileLayout} with the result.
 *
 * @param raw - The reserved key value as stored (expected: a JSON string).
 * @returns A best-effort layout, or `null` if it can't be parsed into the expected shape.
 */
export function parseLayout(raw: unknown): GlobalsLayout | null {
	if (typeof raw !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const o = parsed as Record<string, unknown>;
	if (!Array.isArray(o.sections)) return null;

	const sections: GlobalsSection[] = [];
	for (const s of o.sections) {
		if (!s || typeof s !== 'object') continue;
		const so = s as Record<string, unknown>;
		if (typeof so.id !== 'string' || !so.id) continue;
		const fields = Array.isArray(so.fields)
			? so.fields.filter((f): f is string => typeof f === 'string')
			: [];
		sections.push({
			id: so.id,
			name: typeof so.name === 'string' ? so.name : DEFAULT_SECTION_NAME,
			collapsed: so.collapsed === true,
			fields
		});
	}

	const fieldSort: GlobalsFieldSort = o.fieldSort === 'alpha' ? 'alpha' : 'manual';
	const defaultSectionId = typeof o.defaultSectionId === 'string' ? o.defaultSectionId : '';
	return { sections, defaultSectionId, fieldSort };
}

/**
 * Normalize a (possibly null / stale / hand-edited) layout against the set of fields that actually
 * exist on the record — the Globals editor's lazy-heal, mirroring the manifest reconcile pattern.
 * Pure and DOM-free so it is unit-testable.
 *
 * Rules:
 * 1. A field id referenced by a section but absent from `editableKeys` is dropped (stale reference).
 * 2. A field appearing in more than one section is kept only in the first (de-dupe).
 * 3. Editable keys present on the record but in no section are appended to the default section
 *    (falling back to the first section), in `editableKeys` order.
 * 4. If there are zero sections, a single `DEFAULT_SECTION_NAME` section holding every key is created.
 * 5. `defaultSectionId` is repaired to point at an existing section (first one) if it dangles.
 * 6. Empty sections are preserved — identity lives in `__layout`, not inferred from membership.
 *
 * @param layout - Decoded layout (or `null` for a legacy / first-run record).
 * @param editableKeys - The record's actual user-field keys, in their canonical order.
 * @returns A fresh, internally-consistent {@link GlobalsLayout} (never mutates the input).
 */
export function reconcileLayout(
	layout: GlobalsLayout | null,
	editableKeys: string[]
): GlobalsLayout {
	const present = new Set(editableKeys);

	// No usable layout → one default section with every field in record order.
	if (!layout || layout.sections.length === 0) {
		const id = nextSectionId();
		return {
			sections: [{ id, name: DEFAULT_SECTION_NAME, collapsed: false, fields: [...editableKeys] }],
			defaultSectionId: id,
			fieldSort: layout?.fieldSort ?? 'manual'
		};
	}

	const seen = new Set<string>();
	const sections: GlobalsSection[] = layout.sections.map((s) => ({
		id: s.id,
		name: s.name,
		collapsed: s.collapsed,
		fields: s.fields.filter((f) => {
			if (!present.has(f) || seen.has(f)) return false; // rules 1 + 2
			seen.add(f);
			return true;
		})
	}));

	// Rule 3: orphan keys (present, unplaced) → default section, in record order.
	const orphans = editableKeys.filter((k) => !seen.has(k));
	if (orphans.length > 0) {
		const target = sections.find((s) => s.id === layout.defaultSectionId) ?? sections[0];
		target.fields.push(...orphans);
	}

	// Rule 5: repair a dangling defaultSectionId.
	const defaultSectionId = sections.some((s) => s.id === layout.defaultSectionId)
		? layout.defaultSectionId
		: sections[0].id;

	return { sections, defaultSectionId, fieldSort: layout.fieldSort };
}

/**
 * Order a section's field keys for render given the layout's `fieldSort`. `manual` is identity (the
 * stored order); `alpha` sorts a copy case-insensitively. Kept here so the component and tests share
 * one definition.
 *
 * @param fields - The section's stored field keys.
 * @param sort - The active sort mode.
 * @returns A (possibly new) array in render order.
 */
export function orderedFields(fields: string[], sort: GlobalsFieldSort): string[] {
	if (sort === 'alpha') return [...fields].sort((a, b) => a.localeCompare(b));
	return fields;
}
