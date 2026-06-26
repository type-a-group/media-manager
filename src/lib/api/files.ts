import { z } from 'zod';
import {
	FileListResponseSchema,
	ClassSummarySchema,
	SchemaDefinitionSchema,
	ClassConfigSchema,
	JsonRecordSchema,
	type FileListResponse,
	type ClassSummary,
	type SchemaDefinition,
	type ClassConfig,
	type AddFieldRequest,
	type UpdateFieldRequest
} from '$lib/core/types.js';
import type { ImageId } from '$lib/core/ids.js';

/** Client wrappers for the file-first `/api/files` + `/api/classes` surface. */

async function jsonOrThrow<S extends z.ZodTypeAny>(
	res: Response,
	schema: S,
	msg: string
): Promise<z.infer<S>> {
	if (!res.ok) {
		let details = '';
		try {
			details = await res.text();
		} catch {
			/* ignore */
		}
		throw new Error(`${msg} (status ${res.status})${details ? `: ${details}` : ''}`);
	}
	return schema.parse(await res.json());
}

// ---- Files ----------------------------------------------------------------

export interface ListFilesParams {
	query?: string;
	classIds?: string[];
	matchAll?: boolean;
	unclassified?: boolean;
	/** Group the result by one class's field (the multi-class "all of" view). */
	groupByClass?: string;
	groupByField?: string;
	/** Scope `query`: empty = filename/All-fields; `<classId>::<field>` = one intersected field. */
	searchField?: string;
	/** List sort key (Item 9): a built-in (`name` | `created_at` | `size`); empty = persisted/default. */
	sort?: string;
	/** Sort direction. */
	dir?: 'asc' | 'desc';
}

/** GET /api/files — the All Files hub listing. */
export async function apiListFiles(
	params: ListFilesParams = {},
	fetchFn: typeof fetch = fetch
): Promise<FileListResponse> {
	const q = new URLSearchParams();
	if (params.query) q.set('query', params.query);
	if (params.classIds?.length) q.set('classIds', params.classIds.join(','));
	if (params.matchAll) q.set('match', 'all');
	if (params.unclassified) q.set('unclassified', 'true');
	if (params.groupByClass && params.groupByField) {
		q.set('groupByClass', params.groupByClass);
		q.set('groupByField', params.groupByField);
	}
	if (params.searchField) q.set('searchField', params.searchField);
	if (params.sort) q.set('sort', params.sort);
	if (params.dir) q.set('dir', params.dir);
	const res = await fetchFn(`/api/files?${q.toString()}`);
	return jsonOrThrow(res, FileListResponseSchema, 'Failed to list files');
}

/** URL for a blob's bytes (thumbnail / preview). */
export function apiBlobUrl(id: ImageId): string {
	return `/api/files/${id}/blob`;
}

export async function apiUploadFile(
	file: File,
	conflictResolution?: 'overwrite' | 'auto-rename',
	fetchFn: typeof fetch = fetch
): Promise<{ id: string; filename: string }> {
	const fd = new FormData();
	fd.append('file', file);
	if (conflictResolution) fd.append('conflict_resolution', conflictResolution);
	const res = await fetchFn('/api/files/upload', { method: 'POST', body: fd });
	return jsonOrThrow(
		res,
		z.object({ success: z.literal(true), id: z.string(), filename: z.string() }),
		'Upload failed'
	);
}

export async function apiRenameFile(
	id: ImageId,
	newFilename: string,
	fetchFn: typeof fetch = fetch
): Promise<string> {
	const res = await fetchFn(`/api/files/${id}/rename`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ new_filename: newFilename })
	});
	const data = await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), filename: z.string() }),
		'Rename failed'
	);
	return data.filename;
}

export async function apiDeleteFilesFromDisk(
	ids: ImageId[],
	fetchFn: typeof fetch = fetch
): Promise<void> {
	const res = await fetchFn('/api/files/delete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids })
	});
	await jsonOrThrow(res, z.object({ success: z.literal(true) }), 'Delete failed');
}

export const FileClassesResponseSchema = z.object({
	classes: z.array(
		z.object({
			id: z.string(),
			displayName: z.string(),
			schema: SchemaDefinitionSchema,
			config: ClassConfigSchema,
			record: JsonRecordSchema.nullable()
		})
	)
});
export type FileClassesResponse = z.infer<typeof FileClassesResponseSchema>;

/** GET /api/files/[id]/classes — class sections for the per-file editor. */
export async function apiGetFileClasses(
	id: ImageId,
	fetchFn: typeof fetch = fetch
): Promise<FileClassesResponse> {
	const res = await fetchFn(`/api/files/${id}/classes`);
	return jsonOrThrow(res, FileClassesResponseSchema, 'Failed to load file classes');
}

export const MissingFilesResponseSchema = z.object({
	count: z.number(),
	files: z.array(
		z.object({
			file_id: z.string(),
			file_name: z.string(),
			refs: z.array(
				z.object({
					file_id: z.string(),
					file_name: z.string(),
					context: z.string(),
					label: z.string(),
					field: z.string().nullable()
				})
			)
		})
	)
});
export type MissingFilesResponse = z.infer<typeof MissingFilesResponseSchema>;

/** GET /api/files/missing — the global missing-files warning surface. */
export async function apiGetMissingFiles(
	fetchFn: typeof fetch = fetch
): Promise<MissingFilesResponse> {
	const res = await fetchFn('/api/files/missing');
	return jsonOrThrow(res, MissingFilesResponseSchema, 'Failed to load missing files');
}

export async function apiGetFileMetadata(
	id: ImageId,
	fetchFn: typeof fetch = fetch
): Promise<unknown> {
	const res = await fetchFn(`/api/files/${id}/metadata`);
	if (!res.ok) throw new Error(`Failed to load metadata (status ${res.status})`);
	return res.json();
}

export async function apiStripFileMetadata(
	id: ImageId,
	mode: 'all' | 'gps',
	fetchFn: typeof fetch = fetch
): Promise<unknown> {
	const res = await fetchFn(`/api/files/${id}/metadata/strip`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode })
	});
	if (!res.ok) throw new Error(`Failed to strip metadata (status ${res.status})`);
	return res.json();
}

// ---- Classes --------------------------------------------------------------

/** GET /api/classes — list classes with member counts. */
export async function apiListClasses(fetchFn: typeof fetch = fetch): Promise<ClassSummary[]> {
	const res = await fetchFn('/api/classes');
	return jsonOrThrow(res, z.array(ClassSummarySchema), 'Failed to list classes');
}

export async function apiCreateClass(
	displayName: string,
	schema?: SchemaDefinition,
	fetchFn: typeof fetch = fetch
): Promise<ClassSummary> {
	const res = await fetchFn('/api/classes', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ displayName, ...(schema ? { schema } : {}) })
	});
	return jsonOrThrow(res, ClassSummarySchema, 'Failed to create class');
}

export const ClassDetailSchema = z.object({
	id: z.string(),
	schema: SchemaDefinitionSchema,
	config: ClassConfigSchema
});
export type ClassDetail = z.infer<typeof ClassDetailSchema>;

export async function apiGetClass(id: string, fetchFn: typeof fetch = fetch): Promise<ClassDetail> {
	const res = await fetchFn(`/api/classes/${id}`);
	return jsonOrThrow(res, ClassDetailSchema, 'Failed to load class');
}

export async function apiUpdateClassConfig(
	id: string,
	patch: Partial<ClassConfig>,
	fetchFn: typeof fetch = fetch
): Promise<ClassConfig> {
	const res = await fetchFn(`/api/classes/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	const data = await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), config: ClassConfigSchema }),
		'Failed to update class'
	);
	return data.config;
}

export async function apiDeleteClass(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
	const res = await fetchFn(`/api/classes/${id}`, { method: 'DELETE' });
	await jsonOrThrow(res, z.object({ success: z.literal(true) }), 'Failed to delete class');
}

/** GET /api/classes/[id]/members — the one-class catalog view. */
export async function apiListClassMembers(
	id: string,
	opts: {
		groupBy?: string;
		query?: string;
		searchField?: string;
		sort?: string;
		dir?: 'asc' | 'desc';
	} = {},
	fetchFn: typeof fetch = fetch
): Promise<FileListResponse> {
	const q = new URLSearchParams();
	if (opts.groupBy) q.set('groupBy', opts.groupBy);
	if (opts.query) q.set('query', opts.query);
	if (opts.searchField) q.set('searchField', opts.searchField);
	if (opts.sort) q.set('sort', opts.sort);
	if (opts.dir) q.set('dir', opts.dir);
	const res = await fetchFn(`/api/classes/${id}/members?${q.toString()}`);
	return jsonOrThrow(res, FileListResponseSchema, 'Failed to list members');
}

export async function apiAddMembers(
	id: string,
	ids: ImageId[],
	fetchFn: typeof fetch = fetch
): Promise<void> {
	const res = await fetchFn(`/api/classes/${id}/members`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids })
	});
	await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), added: z.number() }),
		'Failed to add members'
	);
}

export async function apiRemoveMembers(
	id: string,
	ids: ImageId[],
	fetchFn: typeof fetch = fetch
): Promise<void> {
	const res = await fetchFn(`/api/classes/${id}/members`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids })
	});
	await jsonOrThrow(res, z.object({ success: z.literal(true) }), 'Failed to remove members');
}

export async function apiGetClassRecord(
	id: string,
	fileId: ImageId,
	fetchFn: typeof fetch = fetch
): Promise<z.infer<typeof JsonRecordSchema>> {
	const res = await fetchFn(`/api/classes/${id}/records/${fileId}`);
	return jsonOrThrow(res, JsonRecordSchema, 'Failed to load record');
}

export async function apiUpdateClassRecord(
	id: string,
	fileId: ImageId,
	patch: Record<string, unknown>,
	fetchFn: typeof fetch = fetch
): Promise<z.infer<typeof JsonRecordSchema>> {
	const res = await fetchFn(`/api/classes/${id}/records/${fileId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	return jsonOrThrow(res, JsonRecordSchema, 'Failed to update record');
}

// ---- Class schema editing -------------------------------------------------

export async function apiAddClassField(
	id: string,
	body: AddFieldRequest,
	fetchFn: typeof fetch = fetch
): Promise<SchemaDefinition> {
	const res = await fetchFn(`/api/classes/${id}/schema`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), schema: SchemaDefinitionSchema }),
		'Failed to add field'
	);
	return data.schema;
}

export async function apiUpdateClassField(
	id: string,
	body: UpdateFieldRequest,
	fetchFn: typeof fetch = fetch
): Promise<SchemaDefinition> {
	const res = await fetchFn(`/api/classes/${id}/schema`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), schema: SchemaDefinitionSchema }),
		'Failed to update field'
	);
	return data.schema;
}

export async function apiDeleteClassField(
	id: string,
	fieldName: string,
	removeFromRecords: boolean,
	fetchFn: typeof fetch = fetch
): Promise<SchemaDefinition> {
	const res = await fetchFn(`/api/classes/${id}/schema`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ fieldName, removeFromImages: removeFromRecords })
	});
	const data = await jsonOrThrow(
		res,
		z.object({ success: z.literal(true), schema: SchemaDefinitionSchema }),
		'Failed to delete field'
	);
	return data.schema;
}
