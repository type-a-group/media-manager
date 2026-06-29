import { z } from 'zod';
import type { FieldType } from './types.js';

/**
 * Filter clause: one row in the multi-filter UI.
 * Used by list API and repo to filter image records (ANDed together).
 *
 * @param field - Schema field key (or image_name)
 * @param operator - Operator ID; valid set depends on field type (see operatorsByFieldType).
 * @param value - Optional; omitted for "is empty" / "is not empty".
 */
export const FilterClauseSchema = z.object({
	field: z.string().min(1),
	operator: z.string().min(1),
	value: z.union([z.string(), z.number(), z.boolean()]).optional()
});
export type FilterClause = z.infer<typeof FilterClauseSchema>;

/** Operator IDs used in API and UI. Same IDs in repo evaluation and sidebar. */
export const OPERATORS = {
	equals: 'equals',
	contains: 'contains',
	starts_with: 'starts_with',
	ends_with: 'ends_with',
	is_empty: 'is_empty',
	is_not_empty: 'is_not_empty',
	less_than: 'less_than',
	less_than_or_equal: 'less_than_or_equal',
	greater_than: 'greater_than',
	greater_than_or_equal: 'greater_than_or_equal',
	does_not_contain: 'does_not_contain'
} as const;

export type OperatorId = (typeof OPERATORS)[keyof typeof OPERATORS];

/** Human-readable labels for operator dropdown. */
export const OPERATOR_LABELS: Record<OperatorId, string> = {
	[OPERATORS.equals]: 'equals',
	[OPERATORS.contains]: 'contains',
	[OPERATORS.starts_with]: 'starts with',
	[OPERATORS.ends_with]: 'ends with',
	[OPERATORS.is_empty]: 'is empty',
	[OPERATORS.is_not_empty]: 'is not empty',
	[OPERATORS.less_than]: 'less than',
	[OPERATORS.less_than_or_equal]: 'less than or equal',
	[OPERATORS.greater_than]: 'greater than',
	[OPERATORS.greater_than_or_equal]: 'greater than or equal',
	[OPERATORS.does_not_contain]: 'does not contain'
};

/** Operators available for string/url fields. Default (first) is contains for new filter rows. */
export const STRING_OPERATORS: OperatorId[] = [
	OPERATORS.contains,
	OPERATORS.equals,
	OPERATORS.starts_with,
	OPERATORS.ends_with,
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
];

/** Operators available for number fields. */
export const NUMBER_OPERATORS: OperatorId[] = [
	OPERATORS.equals,
	OPERATORS.less_than,
	OPERATORS.less_than_or_equal,
	OPERATORS.greater_than,
	OPERATORS.greater_than_or_equal,
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
];

/** Operators available for list fields (array of strings). */
export const LIST_OPERATORS: OperatorId[] = [
	OPERATORS.contains,
	OPERATORS.does_not_contain,
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
];

/** Operators available for dropdown (single value from options). */
export const DROPDOWN_OPERATORS: OperatorId[] = [
	OPERATORS.equals,
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
];

/** Operators available for boolean fields. */
export const BOOLEAN_OPERATORS: OperatorId[] = [
	OPERATORS.equals,
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
];

/**
 * Returns the list of operator IDs valid for a given schema field type.
 * Used by the sidebar to populate the operator dropdown per row.
 *
 * @param fieldType - Schema field type (string, number, list, dropdown, boolean, url)
 * @returns Array of operator IDs
 */
export function getOperatorsForFieldType(fieldType: FieldType): OperatorId[] {
	switch (fieldType) {
		case 'string':
		case 'url':
		case 'file':
			return STRING_OPERATORS;
		case 'number':
			return NUMBER_OPERATORS;
		case 'list':
			return LIST_OPERATORS;
		case 'dropdown':
			return DROPDOWN_OPERATORS;
		case 'boolean':
			return BOOLEAN_OPERATORS;
		default:
			return STRING_OPERATORS;
	}
}

/** Operators that do not require a value (is empty / is not empty). */
export const VALUE_LESS_OPERATORS: Set<string> = new Set([
	OPERATORS.is_empty,
	OPERATORS.is_not_empty
]);

/**
 * The single "is this field value empty?" predicate, shared by the repo filter evaluators
 * (`jsonRepo.evaluateClause` / `classRepo.evaluateClause`) and the "Incomplete only" filter
 * (Item 10). A value is empty when it is the empty string, `null`/`undefined`, an empty list,
 * or a `url`-type value object whose `url` is blank. This is the **one** definition of empty —
 * the `is_empty` / `is_not_empty` operators and the incomplete check must agree, so both consume
 * this rather than re-deriving it.
 *
 * @param v - A raw field value (post-normalization) from a record/member row.
 * @returns `true` when the field should count as "has no value".
 */
export function isEmptyValue(v: unknown): boolean {
	if (v === '' || v === undefined || v === null) return true;
	if (Array.isArray(v) && v.length === 0) return true;
	if (v != null && typeof v === 'object' && 'url' in (v as object))
		return !((v as { url?: string }).url ?? '').trim();
	return false;
}

/**
 * "Incomplete" predicate (Item 10): does this record have **any** empty value among the given
 * field keys? Used server-side for the `?incomplete=1` flag — the keys are the entity's user
 * fields (`schemaUserFieldKeys` for json types, all schema keys for a Files class). Empty per
 * {@link isEmptyValue}.
 *
 * @param rec - The record as a plain key→value map.
 * @param keys - The field keys to check (the entity's user fields).
 * @returns `true` when at least one of `keys` is empty in `rec`.
 */
export function recordHasEmptyField(rec: Record<string, unknown>, keys: string[]): boolean {
	return keys.some((k) => isEmptyValue(rec[k]));
}
