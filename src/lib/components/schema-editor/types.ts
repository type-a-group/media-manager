import type { SchemaDefinition, AddFieldRequest, UpdateFieldRequest } from '$lib/core/types.js';

/**
 * Injected data layer for {@link SchemaEditorBody}, so the same add/edit/delete-field UI drives both
 * class schemas (`/api/classes/[id]/schema`) and `json` media-type schemas
 * (`/api/media-types/[typeId]/schema`). The body owns no API/store coupling — only this adapter.
 */
export interface SchemaEditorAdapter {
	/**
	 * What kind of entity this schema belongs to + its id. Used by the two-way relation link UI to
	 * know whether to offer link config (a `class`'s record field) vs the read-only linked badge (a
	 * `type`'s file field), and to identify the link's class side. Optional for back-compat.
	 */
	entityKind?: 'class' | 'type';
	entityId?: string;
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
