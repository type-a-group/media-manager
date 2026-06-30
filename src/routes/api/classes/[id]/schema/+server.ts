import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getClassSchema,
	addSchemaField,
	updateSchemaField,
	deleteSchemaField,
	importSchema
} from '$lib/storage/classRepo.js';
import {
	isValidLinkCounterpart,
	reconcileClassRecordLinks,
	backfillClassLinks,
	reconcileLinkData
} from '$lib/storage/relationLinks.js';
import {
	AddFieldRequestSchema,
	DeleteFieldRequestSchema,
	UpdateFieldRequestSchema,
	SchemaDefinitionSchema
} from '$lib/core/types.js';
import { isProtectedSchemaKey } from '$lib/core/fieldKeys.js';

const handleErr = (err: unknown): never => {
	if (err && typeof err === 'object' && 'status' in err) throw err as never;
	const msg = (err as Error)?.message;
	if (msg === 'Field not found') throw error(404, 'Field not found in schema');
	if (msg === 'Field not modifiable') throw error(400, 'This field cannot be modified');
	if (msg === 'Field not removable') throw error(400, 'This field cannot be removed');
	if (msg?.includes('not found')) throw error(404, 'Class not found');
	if (msg?.includes('Invalid class id')) throw error(400, msg);
	throw error(500, { message: 'Schema operation failed' });
};

/** GET: This class's schema. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		return json(await getClassSchema(params.id));
	} catch (err) {
		return handleErr(err);
	}
};

/** PUT: Replace the entire schema (import / clone). */
export const PUT: RequestHandler = async ({ params, request }) => {
	const parsed = SchemaDefinitionSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid schema definition');
	try {
		const result = await importSchema(params.id, parsed.data);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		return handleErr(err);
	}
};

/** POST: Add a new field. */
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = AddFieldRequestSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid schema field payload');
	// A two-way link counterpart must pre-exist and be a class-scoped file field on the target type.
	if (
		parsed.data.fieldType === 'record' &&
		parsed.data.linkedField &&
		!isValidLinkCounterpart(params.id, parsed.data.recordType, parsed.data.linkedField)
	)
		throw error(
			400,
			'Link counterpart must be a file field on the target type scoped to this class'
		);
	try {
		const result = await addSchemaField(
			params.id,
			parsed.data.fieldName,
			parsed.data.fieldType,
			parsed.data.defaultValue,
			parsed.data.options,
			parsed.data.itemTypes,
			parsed.data.multiselect,
			parsed.data.suggest,
			parsed.data.recordType,
			parsed.data.classId,
			parsed.data.linkedField
		);
		await reconcileClassRecordLinks(params.id);
		if (parsed.data.linkSync && parsed.data.fieldType === 'record' && parsed.data.linkedField)
			await reconcileLinkData(params.id, parsed.data.fieldName, parsed.data.linkSync);
		else await backfillClassLinks(params.id);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		return handleErr(err);
	}
};

/** PATCH: Update/rename a field. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const parsed = UpdateFieldRequestSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid update payload');
	if (isProtectedSchemaKey(parsed.data.fieldName))
		throw error(400, 'This field cannot be modified');
	// A two-way link counterpart must pre-exist and be a class-scoped file field on the target type.
	if (
		parsed.data.fieldType === 'record' &&
		parsed.data.linkedField &&
		!isValidLinkCounterpart(params.id, parsed.data.recordType, parsed.data.linkedField)
	)
		throw error(
			400,
			'Link counterpart must be a file field on the target type scoped to this class'
		);
	try {
		const result = await updateSchemaField(params.id, parsed.data.fieldName, {
			newKey: parsed.data.newFieldName,
			type: parsed.data.fieldType,
			defaultValue: parsed.data.defaultValue,
			options: parsed.data.options,
			itemTypes: parsed.data.itemTypes,
			multiselect: parsed.data.multiselect,
			suggest: parsed.data.suggest,
			recordType: parsed.data.recordType,
			classId: parsed.data.classId,
			linkedField: parsed.data.linkedField
		});
		await reconcileClassRecordLinks(params.id);
		const linkedFieldKey = parsed.data.newFieldName ?? parsed.data.fieldName;
		if (parsed.data.linkSync && parsed.data.linkedField)
			await reconcileLinkData(params.id, linkedFieldKey, parsed.data.linkSync);
		else await backfillClassLinks(params.id);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		return handleErr(err);
	}
};

/** DELETE: Remove a field. */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const parsed = DeleteFieldRequestSchema.safeParse(await request.json());
	if (!parsed.success) throw error(400, 'Invalid delete payload');
	if (isProtectedSchemaKey(parsed.data.fieldName)) throw error(400, 'This field cannot be removed');
	try {
		const result = await deleteSchemaField(
			params.id,
			parsed.data.fieldName,
			parsed.data.removeFromImages
		);
		// Deleting a record field drops its link declaration — clear the counterpart's back-link.
		await reconcileClassRecordLinks(params.id);
		return json({ success: true, schema: result.schema });
	} catch (err) {
		return handleErr(err);
	}
};
