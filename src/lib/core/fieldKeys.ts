/**
 * Keys that are reserved for system/internal use and should not be created as schema fields.
 *
 * Use case:
 * - Prevent schema editor from overwriting app/system fields.
 * - Used for filtering out non-user fields in the UI.
 */
export const RESERVED_FIELD_KEYS = new Set([
	'id',
	'file_name',
	'last_modified',
	'default',
	'is_template'
]);

/**
 * Keys that cannot be removed or renamed in the schema editor.
 * file_name is system-only (never in schema). image_name (images) and name (JSON) may be in schema.
 *
 * Use case:
 * - Prevent accidental removal/rename of fields required by the app.
 */
export const PROTECTED_SCHEMA_KEYS = new Set(['file_name', 'image_name', 'name']);

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

