import { z } from 'zod';
import { ImageIdSchema } from './ids.js';
import { RESERVED_FIELD_KEYS } from './fieldKeys.js';

/**
 * Allowed schema field primitive types.
 *
 * Use case:
 * - Used by the schema editor and dynamic form rendering to decide which input control to show.
 * - Used by validation/migrations to ensure schema values are coherent.
 */
export const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'dropdown', 'list', 'url', 'file']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/**
 * URL field value: display name and URL (snake_case for stored JSON).
 *
 * Use case:
 * - Stored in records and schema defaults for fields of type `url`.
 * - Normalize legacy string values to this shape on read via normalizeUrlValue().
 */
export const UrlValueSchema = z.object({
	display_name: z.string(),
	url: z.string()
});
export type UrlValue = z.infer<typeof UrlValueSchema>;

/**
 * Normalizes a URL field value to UrlValue.
 * Legacy data may store a plain string; treat as url-only with empty display_name.
 *
 * @param value - Raw value (string or UrlValue object)
 * @returns Normalized UrlValue
 */
export function normalizeUrlValue(value: unknown): UrlValue {
	if (value != null && typeof value === 'object' && 'url' in value && typeof (value as UrlValue).url === 'string') {
		const o = value as Record<string, unknown>;
		return {
			display_name: typeof o.display_name === 'string' ? o.display_name : '',
			url: o.url as string
		};
	}
	if (typeof value === 'string') {
		return { display_name: '', url: value };
	}
	return { display_name: '', url: '' };
}

/**
 * Allowed item types for list fields (string, number, url).
 * Used in schema to define which types of items a list field may contain.
 */
export const ListItemTypeSchema = z.enum(['string', 'number', 'url']);
export type ListItemType = z.infer<typeof ListItemTypeSchema>;

/**
 * Single list item value: string, number, or URL object.
 * Used in list field values and in record catchall.
 */
export const ListItemValueSchema = z.union([z.string(), z.number(), UrlValueSchema]);
export type ListItemValue = z.infer<typeof ListItemValueSchema>;

/**
 * Field definition stored in `schema.json`.
 *
 * Concerns / future improvements:
 * - `defaultValue` depends on `type`; if we expand types, consider a discriminated union schema.
 * - For dropdown: `options` defines the selectable values; `defaultValue` must be in options.
 * - For list: `defaultValue` is array (usually []); `itemTypes` optionally restricts allowed item types.
 * - For url: `defaultValue` may be UrlValue object or legacy string.
 */
export const FieldDefinitionSchema = z.object({
	type: FieldTypeSchema,
	removable: z.boolean(),
	defaultValue: z
		.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.array(z.string()),
			z.array(ListItemValueSchema),
			UrlValueSchema
		])
		.optional(),
	options: z.array(z.string()).optional(),
	itemTypes: z.array(ListItemTypeSchema).optional(),
	/** When true, dropdown stores string[]; otherwise a single string. Omit/false = single. */
	multiselect: z.boolean().optional(),
	/** When true, string fields render as a multiline textarea instead of a single-line input. */
	long: z.boolean().optional()
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

/**
 * Schema definition (map of fieldKey -> field definition).
 */
export const SchemaDefinitionSchema = z.record(FieldDefinitionSchema);
export type SchemaDefinition = z.infer<typeof SchemaDefinitionSchema>;

/**
 * Image record as stored in `image-data.json`.
 *
 * Notes:
 * - `id` is the stable identity used by UI and API endpoints.
 * - `file_name` is the current filename on disk (may change in the future).
 * - Presence in JSON means "linked"; files on disk with no record are "unlinked".
 *
 * Concerns / future improvements:
 * - Consider splitting system fields from user fields explicitly instead of `catchall`.
 * - When adding richer field types, revisit `catchall` union.
 */
export const ImageRecordSchema = z
	.object({
		id: ImageIdSchema,
		file_name: z.string().min(1),
		image_name: z.string().default(''),
		last_modified: z.string().optional(),
		width: z.number().optional(),
		height: z.number().optional()
	})
	.catchall(
		z
			.union([
				z.string(),
				z.number(),
				z.boolean(),
				z.array(ListItemValueSchema),
				UrlValueSchema,
				z.null()
			])
			.optional()
	);
export type ImageRecord = z.infer<typeof ImageRecordSchema>;

/**
 * Wrapper document for `image-data.json`.
 */
export const ImageDataFileSchema = z.object({
	images: z.array(ImageRecordSchema).default([])
});
export type ImageDataFile = z.infer<typeof ImageDataFileSchema>;

/**
 * Wrapper document for `schema.json`.
 */
export const SchemaFileSchema = z.object({
	schema: SchemaDefinitionSchema.default({})
});
export type SchemaFile = z.infer<typeof SchemaFileSchema>;

/**
 * JSON media-type record (no file attachment).
 * Stable id (UUID); last_modified optional; all other keys are schema-driven (catchall).
 *
 * Use case:
 * - Pure JSON media types (e.g. projects list) store records in data.json with this shape.
 *
 * Concerns / future improvements:
 * - Reuses ImageId for id; could introduce RecordId alias or separate type if needed.
 */
export const JsonRecordSchema = z
	.object({
		id: ImageIdSchema,
		last_modified: z.string().optional()
	})
	.catchall(
		z
			.union([
				z.string(),
				z.number(),
				z.boolean(),
				z.array(ListItemValueSchema),
				UrlValueSchema,
				z.null()
			])
			.optional()
	);
export type JsonRecord = z.infer<typeof JsonRecordSchema>;

/**
 * Wrapper document for JSON media-type data file (e.g. data.json).
 */
export const JsonDataFileSchema = z.object({
	records: z.array(JsonRecordSchema).default([])
});
export type JsonDataFile = z.infer<typeof JsonDataFileSchema>;

/**
 * Minimal JSON record info for list views.
 * Includes optional name for sidebar/grid display; when the list API is called with groupBy, each item includes group_by_value.
 */
export const JsonListItemSchema = z.object({
	id: ImageIdSchema,
	name: z.string().optional(),
	group_by_value: z
		.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
		.optional()
});
export type JsonListItem = z.infer<typeof JsonListItemSchema>;

/**
 * API: JSON record list response (single list; no linked/unlinked/missing_files).
 */
export const JsonListResponseSchema = z.object({
	records: z.array(JsonListItemSchema).default([])
});
export type JsonListResponse = z.infer<typeof JsonListResponseSchema>;

/**
 * Minimal image info for list views.
 * When the list API is called with groupBy, each item includes group_by_value for that field.
 * Id may be a UUID (linked, in JSON) or "unlinked:" + filename (not in JSON).
 */
export const ImageListItemSchema = z.object({
	id: ImageIdSchema,
	file_name: z.string(),
	image_name: z.string().optional(),
	group_by_value: z
		.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
		.optional(),
	width: z.number().optional(),
	height: z.number().optional()
});
export type ImageListItem = z.infer<typeof ImageListItemSchema>;

/**
 * API: image list response.
 */
export const ImageListResponseSchema = z.object({
	linked: z.array(ImageListItemSchema).default([]),
	unlinked: z.array(ImageListItemSchema).default([]),
	missing_files: z.array(ImageListItemSchema).default([]),
	excluded: z.array(ImageListItemSchema).default([]),
	excluded_missing_files: z.array(z.string()).default([])
});
export type ImageListResponse = z.infer<typeof ImageListResponseSchema>;

const FieldKeySchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z_][a-z0-9_]*$/, 'Field keys must be snake_case')
	.refine(
		(k) => !RESERVED_FIELD_KEYS.has(k),
		'This field name is reserved'
	);

/**
 * API: payload for adding a new field to the schema.
 * For list fields, itemTypes defaults to ['string'] if omitted.
 */
export const AddFieldRequestSchema = z.object({
	fieldName: FieldKeySchema,
	fieldType: FieldTypeSchema,
	defaultValue: z
		.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.array(z.string()),
			z.array(ListItemValueSchema),
			UrlValueSchema
		])
		.optional(),
	options: z.array(z.string()).optional(),
	itemTypes: z.array(ListItemTypeSchema).optional(),
	multiselect: z.boolean().optional(),
	long: z.boolean().optional()
});
export type AddFieldRequest = z.infer<typeof AddFieldRequestSchema>;

/**
 * API: payload for deleting an existing field from the schema.
 *
 * @param removeFromImages - When true, delete the field from all image records; otherwise only remove from schema (data becomes custom fields).
 */
export const DeleteFieldRequestSchema = z.object({
	fieldName: FieldKeySchema,
	removeFromImages: z.boolean().optional()
});
export type DeleteFieldRequest = z.infer<typeof DeleteFieldRequestSchema>;

/**
 * API: payload for updating an existing field in the schema (rename, type, default, options).
 * For list fields, itemTypes can be updated.
 */
export const UpdateFieldRequestSchema = z.object({
	fieldName: FieldKeySchema,
	newFieldName: FieldKeySchema.optional(),
	fieldType: FieldTypeSchema.optional(),
	defaultValue: z
		.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.array(z.string()),
			z.array(ListItemValueSchema),
			UrlValueSchema
		])
		.optional(),
	options: z.array(z.string()).optional(),
	itemTypes: z.array(ListItemTypeSchema).optional(),
	multiselect: z.boolean().optional(),
	long: z.boolean().optional()
});
export type UpdateFieldRequest = z.infer<typeof UpdateFieldRequestSchema>;

/**
 * API: properties update payload.
 *
 * Notes:
 * - Keys are user-defined; values are primitive, array (list), url object, or null.
 * - Use null to remove a key from the record (e.g. custom field removal).
 */
export const UpdatePropertiesRequestSchema = z.record(
	z
		.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.array(ListItemValueSchema),
			UrlValueSchema,
			z.null()
		])
		.optional()
);
export type UpdatePropertiesRequest = z.infer<typeof UpdatePropertiesRequestSchema>;

/**
 * API: generic success response.
 */
export const SuccessResponseSchema = z.object({
	success: z.literal(true)
});
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

