import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageRepo } from '$lib/server/imageRepo.js';
import {
	AddFieldRequestSchema,
	DeleteFieldRequestSchema,
	UpdateFieldRequestSchema
} from '$lib/core/types.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';

// GET handler to retrieve the schema
export const GET: RequestHandler = async () => {
	try {
		const schema = await imageRepo.getSchema();
		return json(schema);
	} catch {
		throw error(500, { message: 'Failed to read schema' });
	}
};

// POST handler to add a new field to the schema
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = AddFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid schema field payload');

		const result = await imageRepo.addSchemaField(
			parsed.data.fieldName,
			parsed.data.fieldType,
			parsed.data.defaultValue,
			parsed.data.options,
			parsed.data.itemTypes,
			parsed.data.multiselect,
			parsed.data.long
		);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as any;
		throw error(500, { message: 'Failed to update schema' });
	}
};

// PATCH handler to update/rename a field in the schema
export const PATCH: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = UpdateFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid update payload');

		const key = parsed.data.fieldName;
		if (isProtectedSchemaKey(key)) throw error(400, 'This field cannot be modified');

		const result = await imageRepo.updateSchemaField(key, {
			newKey: parsed.data.newFieldName,
			type: parsed.data.fieldType,
			defaultValue: parsed.data.defaultValue,
			options: parsed.data.options,
			itemTypes: parsed.data.itemTypes,
			multiselect: parsed.data.multiselect,
			long: parsed.data.long
		});
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as any;
		const msg = (err as any)?.message;
		if (msg === 'Field not found') throw error(404, 'Field not found in schema');
		if (msg === 'Field not modifiable') throw error(400, 'This field cannot be modified');
		throw error(500, { message: 'Failed to update field' });
	}
};

// DELETE handler to remove a field from the schema
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const parsed = DeleteFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid delete payload');

		const key = parsed.data.fieldName;
		if (isProtectedSchemaKey(key)) throw error(400, 'This field cannot be removed');

		const result = await imageRepo.deleteSchemaField(key, parsed.data.removeFromImages);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as any;
		const msg = (err as any)?.message;
		if (msg === 'Field not found') throw error(404, 'Field not found in schema');
		if (msg === 'Field not removable') throw error(400, 'This field cannot be removed');
		throw error(500, { message: 'Failed to delete field' });
	}
};