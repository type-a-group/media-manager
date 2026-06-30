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
	/**
	 * Optional key ordering (defaults to the schema's own key order). When the entity pins a field
	 * first (e.g. a record type's `name`), this reflects it; the reorder UI keeps that key fixed.
	 */
	orderKeys?: (s: SchemaDefinition) => string[];
	/**
	 * Optional reorder write. Persists `orderedKeys` as the schema's field order. When absent, the
	 * editor hides its drag/reorder affordances (back-compat).
	 */
	reorderFields?: (orderedKeys: string[]) => Promise<unknown>;
}
