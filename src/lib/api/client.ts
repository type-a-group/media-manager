import {
	AddFieldRequestSchema,
	DeleteFieldRequestSchema,
	ImageListResponseSchema,
	JsonListResponseSchema,
	SchemaDefinitionSchema,
	SuccessResponseSchema,
	UpdateFieldRequestSchema,
	UpdatePropertiesRequestSchema
} from '$lib/core/types.js';
import { ImageIdSchema, type ImageId } from '$lib/core/ids.js';
import { z } from 'zod';

/** Media type summary from GET /api/media-types. */
export const MediaTypeSummarySchema = z.object({
	id: z.string(),
	displayName: z.string(),
	kind: z.enum(['images', 'json', 'generic', 'blob_store'])
});
export type MediaTypeSummary = z.infer<typeof MediaTypeSummarySchema>;

/** Media type stats from GET /api/media-types/[typeId]/stats. */
export const MediaTypeStatsSchema = z.object({
	recordCount: z.number(),
	kind: z.enum(['images', 'json', 'generic', 'blob_store']),
	lastUpdated: z.string().nullable()
});
export type MediaTypeStats = z.infer<typeof MediaTypeStatsSchema>;

/** Union of list response shapes (images vs json). */
export type ListRecordsResponse =
	| z.infer<typeof ImageListResponseSchema>
	| z.infer<typeof JsonListResponseSchema>;

/**
 * Ensure a fetch Response is OK, otherwise throw with a useful message.
 *
 * @param res - Fetch response
 * @param message - Fallback error message
 */
async function assertOk(res: Response, message: string): Promise<void> {
	if (res.ok) return;
	let details = '';
	try {
		details = await res.text();
	} catch {
		// ignore
	}
	throw new Error(`${message} (status ${res.status})${details ? `: ${details}` : ''}`);
}

/** Filter clause for multi-filter list API. */
export type ListImagesFilter = {
	field: string;
	operator: string;
	value?: string | number | boolean;
};

// --- Media types (multi-type layout) ---

/**
 * List all media types (scan root for valid folders).
 */
export async function apiListMediaTypes(
	fetchFn: typeof fetch = fetch
): Promise<MediaTypeSummary[]> {
	const res = await fetchFn('/api/media-types');
	await assertOk(res, 'Failed to list media types');
	const json = await res.json();
	return z.array(MediaTypeSummarySchema).parse(json);
}

/**
 * Create a new media type. Body: { displayName, kind: 'images' | 'json' | 'generic' }.
 */
export async function apiCreateMediaType(
	body: { displayName: string; kind: 'images' | 'json' | 'generic' },
	fetchFn: typeof fetch = fetch
): Promise<MediaTypeSummary> {
	const res = await fetchFn('/api/media-types', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to create media type');
	const json = await res.json();
	return MediaTypeSummarySchema.parse(json);
}

/**
 * Get media type summary and config (id, displayName, kind, baseDir, filesDir?).
 */
export async function apiGetMediaType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}`);
	await assertOk(res, 'Failed to get media type');
	return await res.json();
}

/**
 * Read the singleton globals record (`/api/media-types/globals/record`).
 */
export async function apiGetGlobalsRecord(fetchFn: typeof fetch = fetch) {
	const res = await fetchFn('/api/media-types/globals/record');
	await assertOk(res, 'Failed to load globals record');
	return await res.json();
}

/**
 * Patch globals fields. Keys with `null` values are removed.
 *
 * @param patch - Partial object of field updates for the singleton globals record
 */
export async function apiUpdateGlobalsRecord(
	patch: Record<string, unknown>,
	fetchFn: typeof fetch = fetch
) {
	const res = await fetchFn('/api/media-types/globals/record', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	await assertOk(res, 'Failed to update globals record');
	return await res.json();
}

/**
 * Get stats for a media type: record count, kind, and last updated (data file mtime).
 * Use case: Info popup on the home page.
 *
 * @param typeId - Media type folder name
 * @returns { recordCount, kind, lastUpdated } with lastUpdated as ISO string or null
 */
export async function apiGetMediaTypeStats(
	typeId: string,
	fetchFn: typeof fetch = fetch
): Promise<MediaTypeStats> {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/stats`);
	await assertOk(res, 'Failed to get media type stats');
	const json = await res.json();
	return MediaTypeStatsSchema.parse(json);
}

/**
 * Rename media type (update displayName only).
 */
export async function apiRenameMediaType(
	typeId: string,
	displayName: string,
	fetchFn: typeof fetch = fetch
) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ displayName })
	});
	await assertOk(res, 'Failed to rename media type');
	return await res.json();
}

/**
 * Delete media type folder and all contents.
 */
export async function apiDeleteMediaType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}`, {
		method: 'DELETE'
	});
	await assertOk(res, 'Failed to delete media type');
	return SuccessResponseSchema.parse(await res.json());
}

// --- Type-scoped API (use when typeId is in the route) ---

export async function apiGetSchemaForType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/schema`);
	await assertOk(res, 'Failed to fetch schema');
	const json = await res.json();
	return SchemaDefinitionSchema.parse(json);
}

export async function apiAddSchemaFieldForType(
	typeId: string,
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = AddFieldRequestSchema.parse(payload);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/schema`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to add schema field');
	return await res.json();
}

export async function apiUpdateSchemaFieldForType(
	typeId: string,
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = UpdateFieldRequestSchema.parse(payload);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/schema`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to update schema field');
	return await res.json();
}

export async function apiDeleteSchemaFieldForType(
	typeId: string,
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = DeleteFieldRequestSchema.parse(payload);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/schema`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to delete schema field');
	return await res.json();
}

/**
 * Replace a media type's entire schema (used by schema import from file and clone-from-type).
 *
 * @param typeId - Target media type
 * @param schema - Full schema definition (validated before sending)
 */
export async function apiImportSchemaForType(
	typeId: string,
	schema: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = SchemaDefinitionSchema.parse(schema);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/schema`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to import schema');
	return await res.json();
}

/**
 * Validate (and optionally fix) records against the current schema.
 *
 * @param typeId - Target media type
 * @param dryRun - When true, only report issues; when false, apply fixes
 * @returns Issues found and number of records fixed
 */
export async function apiRepairRecordsForType(
	typeId: string,
	dryRun: boolean,
	fetchFn: typeof fetch = fetch
): Promise<{
	issues: { id: string; field: string; issue: string; fix?: unknown }[];
	fixed: number;
}> {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records/repair`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ dryRun })
	});
	await assertOk(res, 'Failed to repair records');
	const json = await res.json();
	return {
		issues: Array.isArray(json?.issues) ? json.issues : [],
		fixed: typeof json?.fixed === 'number' ? json.fixed : 0
	};
}

/**
 * Apply the same property patch to many records in one call.
 *
 * @param typeId - Target media type
 * @param ids - Record ids to update
 * @param patch - Property patch applied to each record
 */
export async function apiBulkUpdatePropertiesForType(
	typeId: string,
	ids: ImageId[],
	patch: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = {
		ids: ids.map((id) => ImageIdSchema.parse(id)),
		patch: UpdatePropertiesRequestSchema.parse(patch)
	};
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records/bulk-update`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to bulk update records');
	return await res.json();
}

/**
 * Delete (file-backed: unlink) many records in one call.
 *
 * @param typeId - Target media type
 * @param ids - Record ids to delete
 */
export async function apiBulkDeleteForType(
	typeId: string,
	ids: ImageId[],
	fetchFn: typeof fetch = fetch
) {
	const body = { ids: ids.map((id) => ImageIdSchema.parse(id)) };
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records/bulk-delete`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to bulk delete records');
	return await res.json();
}

export async function apiListRecordsForType(
	typeId: string,
	params?: {
		query?: string;
		field?: string;
		empty?: boolean;
		groupBy?: string;
		titleField?: string;
		filters?: ListImagesFilter[];
	},
	fetchFn: typeof fetch = fetch
): Promise<ListRecordsResponse> {
	const url = new URL(
		`/api/media-types/${encodeURIComponent(typeId)}/records/list`,
		globalThis.location?.origin ?? 'http://localhost'
	);
	if (params?.filters != null && params.filters.length > 0) {
		url.searchParams.set('filters', JSON.stringify(params.filters));
	} else {
		if (params?.query) url.searchParams.set('query', params.query);
		if (params?.field) url.searchParams.set('field', params.field);
		if (params?.empty) url.searchParams.set('empty', 'true');
	}
	if (params?.groupBy) url.searchParams.set('groupBy', params.groupBy);
	if (params?.titleField) url.searchParams.set('titleField', params.titleField);
	const res = await fetchFn(url.pathname + url.search);
	await assertOk(res, 'Failed to list records');
	const json = await res.json();
	// Response may be ImageListResponse or JsonListResponse
	if ('records' in json) return JsonListResponseSchema.parse(json);
	return ImageListResponseSchema.parse(json);
}

export async function apiGetFieldValuesForType(
	typeId: string,
	fieldName: string,
	fetchFn: typeof fetch = fetch
): Promise<{ values: string[] }> {
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/field-values?field=${encodeURIComponent(fieldName)}`
	);
	await assertOk(res, 'Failed to fetch field values');
	const json = await res.json();
	return { values: Array.isArray(json?.values) ? json.values : [] };
}

export async function apiGetRecordByIdForType(
	typeId: string,
	id: ImageId,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}`
	);
	await assertOk(res, 'Failed to fetch record');
	return await res.json();
}

export async function apiUpdatePropertiesByIdForType(
	typeId: string,
	id: ImageId,
	patch: unknown,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const body = UpdatePropertiesRequestSchema.parse(patch);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}
	);
	await assertOk(res, 'Failed to update record');
	return await res.json();
}

export async function apiDeleteRecordForType(
	typeId: string,
	id: ImageId,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}`,
		{ method: 'DELETE' }
	);
	await assertOk(res, 'Failed to delete record');
	return SuccessResponseSchema.parse(await res.json());
}

export async function apiCreateRecordForType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records`, {
		method: 'POST'
	});
	await assertOk(res, 'Failed to create record');
	return await res.json();
}
