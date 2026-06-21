import type { SchemaDefinition } from './types.js';

/**
 * Keys that are reserved for system/internal use and should not be created as schema fields.
 *
 * Use case:
 * - Prevent schema editor from overwriting app/system fields.
 * - Used for filtering out non-user fields in the UI.
 */
export const RESERVED_FIELD_KEYS = new Set(['id', 'last_modified', 'width', 'height']);

/**
 * Keys that cannot be removed or renamed in the schema editor.
 * `id` is the system primary key (a file-backed row's blob identity; never a schema field). image_name
 * (images) and name (JSON) may be in schema.
 *
 * Use case:
 * - Prevent accidental removal/rename of fields required by the app.
 */
export const PROTECTED_SCHEMA_KEYS = new Set(['id', 'image_name', 'name']);

/**
 * Reserved record keys the `globals` singleton uses to emulate a schema (it has none). Field UI
 * types live in `__field_kinds` (key → ValueKind); extra per-field metadata (dropdown `options`,
 * `multiselect`, list `itemType`) lives in `__field_meta` (key → object). Both are JSON-encoded
 * strings stored alongside the data and hidden from the editable field list.
 */
export const GLOBALS_FIELD_KINDS_KEY = '__field_kinds';
export const GLOBALS_FIELD_META_KEY = '__field_meta';
/** All reserved globals meta keys (excluded from the editable/iterated field set). */
export const GLOBALS_META_KEYS = new Set([GLOBALS_FIELD_KINDS_KEY, GLOBALS_FIELD_META_KEY]);

/**
 * Returns whether a key is protected from removal/rename in the schema editor.
 *
 * @param key - Field key from schema
 * @returns true if the key cannot be removed or renamed
 */
export function isProtectedSchemaKey(key: string): boolean {
	return PROTECTED_SCHEMA_KEYS.has(key);
}

/**
 * Returns whether a key should be treated as a user-defined schema field.
 *
 * @param key - Field key from schema/properties
 * @returns true if it is not a reserved system key
 *
 * Concerns / future improvements:
 * - If we add more built-in fields later, update `RESERVED_FIELD_KEYS` accordingly.
 */
export function isUserFieldKey(key: string): boolean {
	return !RESERVED_FIELD_KEYS.has(key);
}

/**
 * Derive a stable display label for a field key.
 *
 * @param key - Schema field key (snake_case preferred; legacy mixed case allowed)
 * @returns Human-friendly label for UI
 *
 * Concerns / future improvements:
 * - Consider storing labels in schema.json instead of deriving them.
 * - For i18n, move labels to a translation layer.
 */
export function fieldLabel(key: string): string {
	if (key === 'image_name') return 'Image Name';
	if (key === 'name') return 'Name';
	if (key === 'file_name') return 'File Name';
	if (key === 'last_modified') return 'Last Modified';
	if (key === 'width') return 'Width';
	if (key === 'height') return 'Height';

	// Prefer snake_case to title case; also tolerate legacy camelCase/mixed case.
	const snake = key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.toLowerCase();

	return snake
		.split('_')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/**
 * Canonical ordered list of a schema's **user-facing** field keys: keeps user fields plus the
 * reserved `name` field, dropping all other system keys, sorted with `name` first then alpha.
 *
 * This is the single source of truth for "which fields does this entity expose to the UI" — the
 * Records list group-by, the record filter panel, the detail-pane field order, the title/subtitle
 * selects, and (Phase 1) the search-field picker all consume it. Previously each of those
 * re-derived the same filter+sort inline.
 *
 * @param schema - The entity's schema definition (key → field definition)
 * @returns Field keys, `name`-first then alphabetical, system keys excluded
 *
 * Concerns / future improvements:
 * - Files **classes** intentionally expose *all* schema keys (no `name`/system filtering); they use
 *   their own enumeration, not this helper.
 */
export function schemaUserFieldKeys(schema: SchemaDefinition): string[] {
	return Object.keys(schema)
		.filter((k) => isUserFieldKey(k) || k === 'name')
		.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
}

/**
 * Same ordering as {@link schemaUserFieldKeys}, mapped to `{ key, label }` for select/dropdown UIs.
 *
 * @param schema - The entity's schema definition
 * @returns `{ key, label }` entries in `name`-first then alphabetical order
 */
export function schemaUserFields(schema: SchemaDefinition): { key: string; label: string }[] {
	return schemaUserFieldKeys(schema).map((k) => ({ key: k, label: fieldLabel(k) }));
}
