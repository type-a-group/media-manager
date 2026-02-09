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
	kind: z.enum(['images', 'json'])
});
export type MediaTypeSummary = z.infer<typeof MediaTypeSummarySchema>;

/** Media type stats from GET /api/media-types/[typeId]/stats. */
export const MediaTypeStatsSchema = z.object({
	recordCount: z.number(),
	kind: z.enum(['images', 'json']),
	lastUpdated: z.string().nullable()
});
export type MediaTypeStats = z.infer<typeof MediaTypeStatsSchema>;

/** Union of list response shapes (images vs json). */
export type ListRecordsResponse = z.infer<typeof ImageListResponseSchema> | z.infer<typeof JsonListResponseSchema>;

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

/**
 * Fetch the current schema (field definitions).
 */
export async function apiGetSchema(fetchFn: typeof fetch = fetch) {
	const res = await fetchFn('/api/schema');
	await assertOk(res, 'Failed to fetch schema');
	const json = await res.json();
	return SchemaDefinitionSchema.parse(json);
}

const AppConfigSchema = z.object({
	imagesDir: z.string(),
	baseDir: z.string().optional()
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Fetch runtime configuration for the UI.
 *
 * Use case:
 * - Display active images directory (especially important for CLI/npx usage).
 */
export async function apiGetConfig(fetchFn: typeof fetch = fetch) {
	const res = await fetchFn('/api/config');
	await assertOk(res, 'Failed to fetch config');
	const json = await res.json();
	return AppConfigSchema.parse(json);
}

/**
 * Add a field to the schema.
 *
 * @param payload - Field creation payload
 */
export async function apiAddSchemaField(
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = AddFieldRequestSchema.parse(payload);
	const res = await fetchFn('/api/schema', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to add schema field');
	return await res.json();
}

/**
 * Update a field in the schema (rename, type, default, options).
 *
 * @param payload - Update payload with fieldName and optional newFieldName, fieldType, defaultValue, options
 */
export async function apiUpdateSchemaField(
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = UpdateFieldRequestSchema.parse(payload);
	const res = await fetchFn('/api/schema', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to update schema field');
	return await res.json();
}

/**
 * Delete a field from the schema.
 *
 * @param payload - Delete payload
 */
export async function apiDeleteSchemaField(
	payload: unknown,
	fetchFn: typeof fetch = fetch
) {
	const body = DeleteFieldRequestSchema.parse(payload);
	const res = await fetchFn('/api/schema', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to delete schema field');
	return await res.json();
}

/** Filter clause for multi-filter list API. */
export type ListImagesFilter = {
	field: string;
	operator: string;
	value?: string | number | boolean;
};

/**
 * List images grouped by linked/unlinked.
 * When groupBy is set, each item includes group_by_value for that schema field.
 * When filters is provided and non-empty, it is sent as the filters param and legacy query/field/empty are omitted.
 *
 * @param params - Optional query, field, empty (legacy), groupBy, or filters (array of { field, operator, value? })
 */
export async function apiListImages(
	params?: {
		query?: string;
		field?: string;
		empty?: boolean;
		groupBy?: string;
		filters?: ListImagesFilter[];
	},
	fetchFn: typeof fetch = fetch
) {
	const url = new URL('/api/images/list', globalThis.location?.origin ?? 'http://localhost');
	if (params?.filters != null && params.filters.length > 0) {
		url.searchParams.set('filters', JSON.stringify(params.filters));
	} else {
		if (params?.query) url.searchParams.set('query', params.query);
		if (params?.field) url.searchParams.set('field', params.field);
		if (params?.empty) url.searchParams.set('empty', 'true');
	}
	if (params?.groupBy) url.searchParams.set('groupBy', params.groupBy);

	const res = await fetchFn(url.pathname + url.search);
	await assertOk(res, 'Failed to list images');
	const json = await res.json();
	return ImageListResponseSchema.parse(json);
}

/**
 * Get unique values for a field across all image records.
 * Used for list field autocomplete (e.g. tags).
 *
 * @param fieldName - Schema field key
 * @returns Array of unique string values
 */
export async function apiGetFieldValues(
	fieldName: string,
	fetchFn: typeof fetch = fetch
): Promise<{ values: string[] }> {
	const res = await fetchFn(`/api/images/field-values?field=${encodeURIComponent(fieldName)}`);
	await assertOk(res, 'Failed to fetch field values');
	const json = await res.json();
	return { values: Array.isArray(json?.values) ? json.values : [] };
}

/**
 * Get properties for a given imageId.
 */
export async function apiGetPropertiesById(id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(`/api/images/properties/by-id/${id}`);
	await assertOk(res, 'Failed to fetch properties');
	return await res.json();
}

/**
 * Update properties for a given imageId.
 *
 * @param id - imageId
 * @param patch - Partial properties update (schema-defined keys)
 */
export async function apiUpdatePropertiesById(
	id: ImageId,
	patch: unknown,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const body = UpdatePropertiesRequestSchema.parse(patch);
	const res = await fetchFn(`/api/images/properties/by-id/${id}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	await assertOk(res, 'Failed to update properties');
	return await res.json();
}

/**
 * Unlink/reset properties for a given imageId (keeps file on disk).
 */
export async function apiUnlinkById(id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(`/api/images/by-id/${id}`, { method: 'DELETE' });
	await assertOk(res, 'Failed to unlink image');
	return SuccessResponseSchema.parse(await res.json());
}

/**
 * Delete the image file from disk and remove its record from image-data.json.
 */
export async function apiDeleteImageFromDisk(id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(`/api/images/by-id/${id}/file`, { method: 'DELETE' });
	await assertOk(res, 'Failed to delete image from disk');
	return SuccessResponseSchema.parse(await res.json());
}

/**
 * Get a URL for displaying an image in `<img src=...>`.
 */
export function apiImageUrlById(id: ImageId): string {
	ImageIdSchema.parse(id);
	return `/api/images/by-id/${id}`;
}

/**
 * Upload an image file.
 *
 * @param file - Browser File object
 * @returns server response containing `id` and `filename`
 */
export async function apiUploadImage(file: File, fetchFn: typeof fetch = fetch) {
	const form = new FormData();
	form.append('image', file);
	const res = await fetchFn('/api/images/upload', { method: 'POST', body: form });
	await assertOk(res, 'Failed to upload image');
	return await res.json();
}

/**
 * Fetch file metadata for an imageId.
 */
export async function apiGetFileMetadataById(id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(`/api/images/file-metadata/by-id/${id}`);
	await assertOk(res, 'Failed to fetch file metadata');
	return await res.json();
}

/**
 * Strip file metadata for an imageId (all or GPS only).
 * Body: { mode: "all" | "gps" }. Returns updated metadata JSON.
 */
export async function apiStripFileMetadataById(
	id: ImageId,
	mode: 'all' | 'gps',
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(`/api/images/file-metadata/by-id/${id}/strip`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode })
	});
	await assertOk(res, 'Failed to strip file metadata');
	return await res.json();
}

// --- Media types (multi-type layout) ---

/**
 * List all media types (scan root for valid folders).
 */
export async function apiListMediaTypes(fetchFn: typeof fetch = fetch): Promise<MediaTypeSummary[]> {
	const res = await fetchFn('/api/media-types');
	await assertOk(res, 'Failed to list media types');
	const json = await res.json();
	return z.array(MediaTypeSummarySchema).parse(json);
}

/**
 * Create a new media type. Body: { displayName, kind: 'images' | 'json' }.
 */
export async function apiCreateMediaType(
	body: { displayName: string; kind: 'images' | 'json' },
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

export async function apiListRecordsForType(
	typeId: string,
	params?: {
		query?: string;
		field?: string;
		empty?: boolean;
		groupBy?: string;
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

export async function apiGetRecordByIdForType(typeId: string, id: ImageId, fetchFn: typeof fetch = fetch) {
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

export async function apiUnlinkByIdForType(typeId: string, id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}`,
		{ method: 'DELETE' }
	);
	await assertOk(res, 'Failed to unlink record');
	return SuccessResponseSchema.parse(await res.json());
}

export async function apiDeleteRecordForType(typeId: string, id: ImageId, fetchFn: typeof fetch = fetch) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}`,
		{ method: 'DELETE' }
	);
	await assertOk(res, 'Failed to delete record');
	return SuccessResponseSchema.parse(await res.json());
}

export async function apiDeleteFromDiskByIdForType(
	typeId: string,
	id: ImageId,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}/file`,
		{ method: 'DELETE' }
	);
	await assertOk(res, 'Failed to delete image from disk');
	return SuccessResponseSchema.parse(await res.json());
}

export function apiImageUrlByIdForType(typeId: string, id: ImageId): string {
	ImageIdSchema.parse(id);
	return `/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}/file`;
}

export async function apiUploadImageForType(
	typeId: string,
	file: File,
	fetchFn: typeof fetch = fetch
) {
	const form = new FormData();
	form.append('image', file);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/upload`, {
		method: 'POST',
		body: form
	});
	await assertOk(res, 'Failed to upload image');
	return await res.json();
}

export async function apiGetFileMetadataByIdForType(
	typeId: string,
	id: ImageId,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/file-metadata/by-id/${encodeURIComponent(id)}`
	);
	await assertOk(res, 'Failed to fetch file metadata');
	return await res.json();
}

/**
 * Strip file metadata for an imageId in a media type (all or GPS only).
 * Body: { mode: "all" | "gps" }. Returns updated metadata JSON.
 */
export async function apiStripFileMetadataByIdForType(
	typeId: string,
	id: ImageId,
	mode: 'all' | 'gps',
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/file-metadata/by-id/${encodeURIComponent(id)}/strip`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode })
		}
	);
	await assertOk(res, 'Failed to strip file metadata');
	return await res.json();
}

export async function apiCreateRecordForType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records`, {
		method: 'POST'
	});
	await assertOk(res, 'Failed to create record');
	return await res.json();
}

/**
 * Add an existing file on disk to the catalog (images kind only).
 * Creates a record in image-data.json and returns it.
 */
export async function apiLinkByFilenameForType(
	typeId: string,
	file_name: string,
	fetchFn: typeof fetch = fetch
) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/records/link`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ file_name })
	});
	await assertOk(res, 'Failed to link image');
	return await res.json();
}

export async function apiGetSettingsForType(typeId: string, fetchFn: typeof fetch = fetch) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/settings`);
	await assertOk(res, 'Failed to fetch settings');
	return await res.json();
}

export async function apiUpdateSettingsForType(
	typeId: string,
	patch: Record<string, unknown>,
	fetchFn: typeof fetch = fetch
) {
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/settings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	await assertOk(res, 'Failed to update settings');
	return await res.json();
}

/**
 * Rename an image file (type-scoped). Updates both disk and image-data.json.
 */
export async function apiRenameFileByIdForType(
	typeId: string,
	id: ImageId,
	newFilename: string,
	fetchFn: typeof fetch = fetch
) {
	ImageIdSchema.parse(id);
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/records/by-id/${encodeURIComponent(id)}/rename`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ new_filename: newFilename })
		}
	);
	await assertOk(res, 'Failed to rename file');
	return await res.json();
}

/**
 * Check which filenames would conflict with existing files on disk.
 */
export async function apiCheckUploadConflictsForType(
	typeId: string,
	filenames: string[],
	fetchFn: typeof fetch = fetch
): Promise<{ conflicts: string[] }> {
	const res = await fetchFn(
		`/api/media-types/${encodeURIComponent(typeId)}/upload/check`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filenames })
		}
	);
	await assertOk(res, 'Failed to check upload conflicts');
	return await res.json();
}

/**
 * Upload an image with explicit conflict resolution.
 */
export async function apiUploadImageForTypeWithResolution(
	typeId: string,
	file: File,
	conflictResolution?: 'overwrite' | 'auto-rename',
	fetchFn: typeof fetch = fetch
) {
	const form = new FormData();
	form.append('image', file);
	if (conflictResolution) form.append('conflict_resolution', conflictResolution);
	const res = await fetchFn(`/api/media-types/${encodeURIComponent(typeId)}/upload`, {
		method: 'POST',
		body: form
	});
	await assertOk(res, 'Failed to upload image');
	return await res.json();
}

