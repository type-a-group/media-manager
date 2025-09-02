import { z } from "zod";

/**
 * Schema for creating new fields in the image metadata schema.
 * Validates field name, type, and default values based on the selected type.
 */
export const newFieldSchema = z.object({
	/**
	 * The name of the new field to create.
	 * Must be non-empty, alphanumeric with underscores, and not conflict with reserved names.
	 */
	fieldName: z
		.string()
		.min(1, "Field name is required")
		.max(50, "Field name must be 50 characters or less")
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Field name must start with a letter or underscore and contain only letters, numbers, and underscores")
		.refine(
			(name) => !['file_name', 'last_modified', 'default', 'image_name'].includes(name),
			"This field name is reserved"
		),
	
	/**
	 * The data type of the new field.
	 * Determines validation rules and default value handling.
	 */
	fieldType: z.enum(['string', 'number', 'boolean'], {
		required_error: "Field type is required"
	}),
	
	/**
	 * Default value for string fields.
	 * Only used when fieldType is 'string'.
	 */
	defaultString: z.string().max(200, "Default value must be 200 characters or less").optional(),
	
	/**
	 * Default value for number fields.
	 * Only used when fieldType is 'number'.
	 */
	defaultNumber: z.number().optional(),
	
	/**
	 * Default value for boolean fields.
	 * Only used when fieldType is 'boolean'.
	 */
	defaultBoolean: z.boolean().optional(),
}).refine((data) => {
	// Ensure default value matches field type
	if (data.fieldType === 'string' && data.defaultString === undefined) {
		return false;
	}
	if (data.fieldType === 'number' && data.defaultNumber === undefined) {
		return false;
	}
	if (data.fieldType === 'boolean' && data.defaultBoolean === undefined) {
		return false;
	}
	return true;
}, {
	message: "Default value is required for the selected field type",
	path: ["defaultString"] // This will be adjusted based on the actual field type
});

export type NewFieldSchema = typeof newFieldSchema;

/**
 * Gets the appropriate default value based on the field type and form data.
 * Used to extract the correct default value when submitting the form.
 * 
 * @param data - The validated form data
 * @returns The default value for the specified field type
 */
export function getDefaultValue(data: z.infer<NewFieldSchema>): string | number | boolean {
	switch (data.fieldType) {
		case 'string':
			return data.defaultString || '';
		case 'number':
			return data.defaultNumber || 0;
		case 'boolean':
			return data.defaultBoolean || false;
		default:
			return '';
	}
}
