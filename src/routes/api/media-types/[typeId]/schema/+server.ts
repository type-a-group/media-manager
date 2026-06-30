import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaTypeRepo } from '$lib/server/imageRepo.js';
import {
	AddFieldRequestSchema,
	DeleteFieldRequestSchema,
	UpdateFieldRequestSchema,
	SchemaDefinitionSchema
} from '$lib/core/types.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';
import { onFileFieldDeleted } from '$lib/storage/relationLinks.js';

/**
 * GET: Return schema for this media type.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const typeId = params.typeId;
		if (typeId === 'globals') return json({});
		const repo = getMediaTypeRepo(typeId);
		const schema = await repo.getSchema();
		return json(schema);
	} catch (err) {
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to read schema' });
	}
};

/**
 * PUT: Replace the entire schema for this media type (import / clone-from-type).
 * Body is a full schema definition (map of fieldKey -> field definition).
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		if (params.typeId === 'globals') throw error(403, 'Schema is not editable for globals');
		const body = await request.json();
		const parsed = SchemaDefinitionSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid schema definition');

		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		if (!('importSchema' in repo))
			throw error(400, 'Schema import not supported for this media type');
		const result = await repo.importSchema(parsed.data);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		if (e.message?.includes('not editable')) throw error(400, e.message);
		throw error(500, { message: 'Failed to import schema' });
	}
};

/**
 * POST: Add a new field to the schema.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		if (params.typeId === 'globals') throw error(403, 'Schema is not editable for globals');
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
			parsed.data.suggest,
			parsed.data.recordType,
			parsed.data.classId
		);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err as never;
		const e = err as Error;
		if (e.message?.includes('Invalid media type id')) throw error(400, e.message);
		if (e.message?.includes('Not a valid media-type folder'))
			throw error(404, 'Media type not found');
		throw error(500, { message: 'Failed to add schema field' });
	}
};

/**
 * PATCH: Update/rename a field in the schema.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		if (params.typeId === 'globals') throw error(403, 'Schema is not editable for globals');
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
			suggest: parsed.data.suggest,
			recordType: parsed.data.recordType,
			classId: parsed.data.classId
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
		if (params.typeId === 'globals') throw error(403, 'Schema is not editable for globals');
		const body = await request.json();
		const parsed = DeleteFieldRequestSchema.safeParse(body);
		if (!parsed.success) throw error(400, 'Invalid delete payload');

		const key = parsed.data.fieldName;
		if (isProtectedSchemaKey(key)) throw error(400, 'This field cannot be removed');

		const typeId = params.typeId;
		const repo = getMediaTypeRepo(typeId);
		// Capture the def before deletion so a linked file field can unlink its class counterpart.
		const deletedDef = (await repo.getSchema())[key];
		const result = await repo.deleteSchemaField(key, parsed.data.removeFromImages);
		if (deletedDef) await onFileFieldDeleted(deletedDef);
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
