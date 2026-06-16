import type { SchemaDefinition, AddFieldRequest, UpdateFieldRequest } from '$lib/core/types.js';

/**
 * Injected data layer for {@link SchemaEditorBody}, so the same add/edit/delete-field UI drives both
 * class schemas (`/api/classes/[id]/schema`) and `json` media-type schemas
 * (`/api/media-types/[typeId]/schema`). The body owns no API/store coupling — only this adapter.
 */
export interface SchemaEditorAdapter {
	/** Fetch the current schema (re-read after every mutation). */
	getSchema: () => Promise<SchemaDefinition>;
	/** Add a field. */
	addField: (body: AddFieldRequest) => Promise<unknown>;
	/** Update / rename a field. */
	updateField: (body: UpdateFieldRequest) => Promise<unknown>;
	/** Delete a field; `removeFromRecords` also strips the value from every member record. */
	deleteField: (fieldName: string, removeFromRecords: boolean) => Promise<unknown>;
	/** Optional key ordering (defaults to a plain locale sort). */
	orderKeys?: (s: SchemaDefinition) => string[];
}
