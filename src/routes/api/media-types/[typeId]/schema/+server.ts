import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import {
	AddFieldRequestSchema,
	DeleteFieldRequestSchema,
	UpdateFieldRequestSchema
} from '$lib/core/types.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';

/**
 * GET: Return schema for this media type.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const schema = await repo.getSchema();
		return json(schema);
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to read schema' });
	}
};

/**
 * POST: Add a new field to the schema.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const parsed = AddFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid schema field payload');

		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const result = await repo.addSchemaField(
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
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to add schema field' });
	}
};

/**
 * PATCH: Update/rename a field in the schema.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const parsed = UpdateFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid update payload');

		const key = parsed.data.fieldName;
		if (isProtectedSchemaKey(key)) throw error(400, 'This field cannot be modified');

		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const result = await repo.updateSchemaField(key, {
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
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const msg = (e as Error)?.message;
		if (msg === 'Field not found') throw error(404, 'Field not found in schema');
		if (msg === 'Field not modifiable') throw error(400, 'This field cannot be modified');
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to update field' });
	}
};

/**
 * DELETE: Remove a field from the schema.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const parsed = DeleteFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid delete payload');

		const key = parsed.data.fieldName;
		if (isProtectedSchemaKey(key)) throw error(400, 'This field cannot be removed');

		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		const result = await repo.deleteSchemaField(key, parsed.data.removeFromImages);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		const msg = (e as Error)?.message;
		if (msg === 'Field not found') throw error(404, 'Field not found in schema');
		if (msg === 'Field not removable') throw error(400, 'This field cannot be removed');
		if (msg?.includes('Invalid media type id')) throw error(400, msg);
		if (msg?.includes('Not a valid media-type folder')) throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to delete field' });
	}
};
